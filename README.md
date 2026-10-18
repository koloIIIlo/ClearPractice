# ClearPractice

Practise speaking English on your Windows computer. Choose a prompt, record a short answer, listen for one improvement, and try again. Your practice stays available offline.

ClearPractice is a practice notebook, not a proficiency test. It does not grade your voice or promise a learning deadline.

## Install and start

ClearPractice targets **Windows 11, 64-bit**. Version **0.1.0** is a development preview.

1. Get a Windows `.exe` or `.msi` installer from [Releases](https://github.com/koloIIIlo/ClearPractice/releases) when a build is published. If no installer is available, use the [desktop build instructions](docs/DEVELOPING.md).
2. Run the installer and open ClearPractice. The current installers are unsigned.
3. Choose your microphone and practice goals. Start with five minutes or the standard session of about thirteen minutes.
4. For offline transcripts, open **Settings → Transcription** and choose **Download and set up local Whisper**. This download starts only when you ask. You can also practise by listening and taking notes without transcription.

## What you can do

- Repeat an answer, practise thought groups, imitate a clip, and use saved expressions.
- Play short drills, including Just a Minute, emphasis, storytelling and interview practice.
- Review transcripts, correct words, compare takes and keep useful phrases.
- Follow guided programmes and revisit an earlier prompt after a gap.
- Prepare for an event with an outline, cue cards and timed rehearsals.
- Practise with a scripted partner offline, or choose optional AI or a local model.
- Keep real-conversation notes, use the pre-talk routine, and exchange listener feedback files.
- Run Club mode with a timing light and counters. Club mode does not record anyone.
- Choose Playful for Journey and effort rewards, or Calm for quiet practice. Skipped days carry no penalty.
- Turn on surprise prompts in **Settings → Practice**. Choose a time window and days. They appear only while the app runs, at most once a day, and skip days with practice. **Not now** dismisses the day's offer. Windows notifications need a separate opt-in.
- Optionally choose your first language for practice ideas in **Exercises → Guides**. The draft tips still need [speaker review](docs/CONTENT_REVIEW.md).

**Help → Guided tour** shows you around. **Help → What's new** opens the [release highlights](CHANGELOG.md).

## Privacy in plain words

Your recordings, transcripts, phrases and notes stay on this computer. There is no ClearPractice account or cloud sync. Local recording, playback, analysis and search work without the internet. Once installed, local Whisper works offline too.

Cloud transcription sends audio to the provider you choose. Cloud coaching sends the text shown in its preview. Each cloud request needs your **Send** action. A preview names the recipient, what will be sent and the estimated cost. It does not send anything. Provider charges use your own API account. You can leave both features off.

An optional local model runs on this computer. Local partner turns may send automatically only if you opt in. Downloads require a click. Surprise notifications are off by default and do not install a background service or start the app with Windows.

**Measured**, **Estimated**, **Your note** and **AI suggestion** tell you where an observation came from. AI suggestions can be wrong. You choose what to keep.

## Keyboard shortcuts

Shortcuts for a drill or Club mode apply while that activity is open and you are outside a text field.

| Keys | Action |
| --- | --- |
| Ctrl+K | Search your saved content and open actions |
| Ctrl+Enter | Start or stop a Studio take; optional in Settings → Practice |
| Ctrl+B | Show or hide the sidebar |
| Alt+← | Go back |
| Ctrl+Plus / Ctrl+Minus / Ctrl+0 | Zoom in, out or reset; Ctrl+mouse wheel also works |
| ? / Esc | Open keyboard help / close a dialog or menu |
| ← / → | Move a playback position slider; Page Up and Page Down move further |
| [ / ] | Move between review markers |
| A / B / S | In A/B listening, play A, play B or switch at the same point; blind mode uses X and Y |
| F | Flag a slip in Just a Minute; mark a filler while playing Catch it |
| → | Advance the Story spine card |
| → / Page Down / Space | Next cue card; ← or Page Up goes back; Esc exits |
| Space / N | In Club mode, start or stop the timer / save and move to the next speaker |
| 1–6 | Club counters: um, uh, so, like, you know, other |

## Your data and backups

By default, your profile lives in `%LOCALAPPDATA%\com.clearpractice.app`. The database is `database\app.sqlite`; audio lives in the profile's recording and clip folders. **Settings → Data** shows the current folder and lets you move it. Windows credentials and WebView settings are kept separately. API keys use Windows Credential Manager.

In **Settings → Data**, choose a backup folder and create a backup. Weekly automatic backups run only while the app is open. You can choose how many to keep. A new backup is checked before older ones are removed.

A backup includes sessions, notes, Trash and original recordings. It leaves out API keys, models and rebuildable caches. Keep a copy on another drive. To restore, use **Check a backup**, read the preview and confirm the replacement. A session export is useful for reading or sharing one session; use a full backup to restore your history.

## For developers

See [Developing ClearPractice](docs/DEVELOPING.md) for setup, commands and architecture. The [blueprint](ClearPractice-App-Blueprint.md) describes the design; [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) records implementation status and remaining desktop checks.
