//! Your own practice prompts and favourite marks (plan 4.13). Bundled prompts
//! live in the frontend content pack; only your choices about them are stored
//! here, so a curriculum update never loses a favourite.
use super::{db_error, DatabaseOwner, Result};
use crate::storage::recording;
use rusqlite::params;
use serde::{Deserialize, Serialize};

pub const TAGS: [&str; 6] = ["daily_life", "explanations", "opinions", "work", "storytelling", "unexpected"];

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Conditions {
    pub familiarity: String,
    pub preparation_seconds: u32,
    pub target_seconds: u32,
    pub audience: Option<String>,
    pub follow_up: bool,
}

/// What you write for a prompt.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptInput {
    pub text: String,
    pub tags: Vec<String>,
    pub conditions: Conditions,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPrompt {
    pub id: String,
    pub text: String,
    pub tags: Vec<String>,
    pub conditions: Conditions,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub prompt_id: String,
    pub favorite: bool,
}

impl PromptInput {
    fn validate(&self) -> Result<(String, String, Option<String>)> {
        let text = self.text.trim();
        if text.chars().count() < 5 || text.chars().count() > 500 || text.contains('\0') {
            return Err("Write the prompt in 5 to 500 characters.".into());
        }
        let mut tags: Vec<&str> = Vec::new();
        for tag in &self.tags {
            let known = TAGS.iter().find(|t| **t == tag.as_str()).ok_or("Choose situations from the list.")?;
            if !tags.contains(known) {
                tags.push(known);
            }
        }
        let c = &self.conditions;
        if !matches!(c.familiarity.as_str(), "familiar" | "unfamiliar") || c.preparation_seconds > 600 || !(10..=600).contains(&c.target_seconds) {
            return Err("Choose familiar or unfamiliar, up to 10 minutes to prepare and 10 seconds to 10 minutes to speak.".into());
        }
        let audience = c.audience.as_deref().map(str::trim).filter(|a| !a.is_empty()).map(str::to_string);
        if audience.as_ref().is_some_and(|a| a.chars().count() > 80 || a.contains('\0')) {
            return Err("Keep the audience under 80 characters.".into());
        }
        Ok((text.to_string(), serde_json::to_string(&tags).map_err(|e| e.to_string())?, audience))
    }
}

type Row = (String, String, String, String, i64, i64, Option<String>, i64);

fn prompt(row: Row) -> UserPrompt {
    let (id, text, tags, familiarity, prep, target, audience, follow_up) = row;
    UserPrompt {
        id,
        text,
        tags: serde_json::from_str(&tags).unwrap_or_default(),
        conditions: Conditions {
            familiarity,
            preparation_seconds: prep.clamp(0, 600) as u32,
            target_seconds: target.clamp(10, 600) as u32,
            audience,
            follow_up: follow_up == 1,
        },
    }
}

const COLUMNS: &str = "id,text,tags,familiarity,preparation_seconds,target_seconds,audience,follow_up";

impl DatabaseOwner {
    pub fn list_user_prompts(&self) -> Result<Vec<UserPrompt>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn
            .prepare(&format!("SELECT {COLUMNS} FROM user_prompts WHERE deleted_at_ms IS NULL ORDER BY created_at_ms DESC, id"))
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)))
            .map_err(db_error)?;
        Ok(rows.collect::<rusqlite::Result<Vec<Row>>>().map_err(db_error)?.into_iter().map(prompt).collect())
    }

    pub fn add_user_prompt(&self, input: &PromptInput) -> Result<UserPrompt> {
        let (text, tags, audience) = input.validate()?;
        let now = recording::now_ms();
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut n = 0u32;
        let id = loop {
            let candidate = if n == 0 { format!("user-prompt-{now}") } else { format!("user-prompt-{now}-{n}") };
            let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM user_prompts WHERE id=?1)", [&candidate], |r| r.get(0)).map_err(db_error)?;
            if !exists {
                break candidate;
            }
            n += 1;
        };
        let c = &input.conditions;
        conn.execute(
            "INSERT INTO user_prompts(id,text,tags,familiarity,preparation_seconds,target_seconds,audience,follow_up,created_at_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![id, text, tags, c.familiarity, c.preparation_seconds, c.target_seconds, audience, i64::from(c.follow_up), now as i64],
        )
        .map_err(db_error)?;
        drop(conn);
        self.list_user_prompts()?.into_iter().find(|p| p.id == id).ok_or_else(|| "The prompt could not be read back.".into())
    }

    /// Changes a prompt's wording or conditions. Sessions keep the text they used.
    pub fn update_user_prompt(&self, id: &str, input: &PromptInput) -> Result<UserPrompt> {
        recording::validate_id(id)?;
        let (text, tags, audience) = input.validate()?;
        let c = &input.conditions;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn
            .execute(
                "UPDATE user_prompts SET text=?1,tags=?2,familiarity=?3,preparation_seconds=?4,target_seconds=?5,audience=?6,follow_up=?7 WHERE id=?8 AND deleted_at_ms IS NULL",
                params![text, tags, c.familiarity, c.preparation_seconds, c.target_seconds, audience, i64::from(c.follow_up), id],
            )
            .map_err(db_error)?;
        drop(conn);
        if count != 1 {
            return Err("This prompt no longer exists.".into());
        }
        self.list_user_prompts()?.into_iter().find(|p| p.id == id).ok_or_else(|| "This prompt no longer exists.".into())
    }

    /// Removes a prompt from the collection; sessions that used it keep their snapshot.
    pub fn delete_user_prompt(&self, id: &str) -> Result<()> {
        recording::validate_id(id)?;
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let count = conn
            .execute("UPDATE user_prompts SET deleted_at_ms=?1 WHERE id=?2 AND deleted_at_ms IS NULL", params![recording::now_ms() as i64, id])
            .map_err(db_error)?;
        if count != 1 {
            return Err("This prompt no longer exists.".into());
        }
        conn.execute("DELETE FROM prompt_favorites WHERE prompt_id=?1", [id]).map_err(db_error)?;
        Ok(())
    }

    /// Your favourite marks; a bundled prompt without a mark keeps the pack's default.
    pub fn prompt_favorites(&self) -> Result<Vec<Favorite>> {
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        let mut stmt = conn.prepare("SELECT prompt_id,favorite FROM prompt_favorites ORDER BY prompt_id").map_err(db_error)?;
        let rows = stmt.query_map([], |r| Ok(Favorite { prompt_id: r.get(0)?, favorite: r.get::<_, i64>(1)? == 1 })).map_err(db_error)?;
        rows.collect::<rusqlite::Result<_>>().map_err(db_error)
    }

    pub fn set_prompt_favorite(&self, prompt_id: &str, favorite: bool) -> Result<()> {
        if prompt_id.is_empty() || prompt_id.len() > 128 || !prompt_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
            return Err("Unknown prompt.".into());
        }
        let conn = self.connection.lock().map_err(|_| "Session storage owner is unavailable.")?;
        conn.execute(
            "INSERT INTO prompt_favorites(prompt_id,favorite,updated_at_ms) VALUES (?1,?2,?3) ON CONFLICT(prompt_id) DO UPDATE SET favorite=excluded.favorite,updated_at_ms=excluded.updated_at_ms",
            params![prompt_id, i64::from(favorite), recording::now_ms() as i64],
        )
        .map_err(db_error)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::recording::tests::TestRoot;

    fn input(text: &str) -> PromptInput {
        PromptInput {
            text: text.into(),
            tags: vec!["work".into(), "work".into(), "explanations".into()],
            conditions: Conditions { familiarity: "unfamiliar".into(), preparation_seconds: 30, target_seconds: 90, audience: Some("  A new colleague ".into()), follow_up: true },
        }
    }

    #[test]
    fn your_prompts_are_added_edited_removed_and_favourites_are_remembered() {
        let root = TestRoot::new();
        let db = DatabaseOwner::open(&root.0).unwrap();
        let added = db.add_user_prompt(&input("  Explain our deploy process to a new colleague. ")).unwrap();
        assert_eq!(added.text, "Explain our deploy process to a new colleague.");
        assert_eq!(added.tags, ["work", "explanations"], "known tags, no duplicates");
        assert_eq!(added.conditions.audience.as_deref(), Some("A new colleague"));
        assert!(db.add_user_prompt(&input("Hi")).is_err());
        assert!(db.add_user_prompt(&PromptInput { tags: vec!["mood".into()], ..input("A valid prompt text") }).is_err());
        assert!(db.add_user_prompt(&PromptInput { conditions: Conditions { target_seconds: 5, ..input("x").conditions }, ..input("A valid prompt text") }).is_err());

        let edited = db.update_user_prompt(&added.id, &PromptInput { conditions: Conditions { audience: Some(" ".into()), follow_up: false, ..input("x").conditions }, ..input("Explain the deploy process in one minute.") }).unwrap();
        assert_eq!((edited.text.as_str(), edited.conditions.audience.as_ref(), edited.conditions.follow_up), ("Explain the deploy process in one minute.", None, false));

        db.set_prompt_favorite("p-habit", false).unwrap();
        db.set_prompt_favorite(&added.id, true).unwrap();
        db.set_prompt_favorite(&added.id, true).unwrap();
        assert!(db.set_prompt_favorite("../x", true).is_err());
        assert_eq!(db.prompt_favorites().unwrap().len(), 2);

        db.delete_user_prompt(&added.id).unwrap();
        assert!(db.list_user_prompts().unwrap().is_empty());
        assert!(db.delete_user_prompt(&added.id).is_err());
        assert_eq!(db.prompt_favorites().unwrap(), vec![Favorite { prompt_id: "p-habit".into(), favorite: false }]);
    }
}
