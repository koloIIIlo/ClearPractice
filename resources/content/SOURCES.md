# Reference clip sources (plan 4.4)

The blueprint (§6) asks for 10 short reference clips (typically 10–20 s) with transcripts for *Listen and imitate*, each keeping its attribution and redistribution permission next to it. The app must also work with user-imported clips if the bundled pack is left out.

Checked 2026-10-08. Nothing has been downloaded yet; each clip's permission must be confirmed on its own page when it is added.

## Shortlist

| Source | Status | Why it fits | Watch out for |
| --- | --- | --- | --- |
| **VOA Learning English** | **First choice.** Its "Request Our Content" page says Learning English texts, MP3s, photos and videos are public domain and may be reprinted for educational and commercial purposes with credit to learningenglish.voanews.com | Clear, natural pacing aimed at learners; scripts published alongside the audio, so transcripts come with the clip | Excludes news-agency material (AP, Reuters, AFP), which stays copyrighted, so use only Learning English's own reports. Credit every clip. VOA's FAQ notes Smith-Mundt limits on distribution inside the US; confirm via their content request form before a public release |
| **LibriVox** | Good for read-aloud passages (thought groups, rhythm) | Recordings are dedicated to the public domain, and the texts are public-domain books, so transcripts are free | Read speech, not conversation. The older dedication tool is the retired CC Public Domain Dedication; record the per-recording statement. Check that the book text is public domain where the app is distributed |
| **Original recordings** | Always allowed | Written and recorded for ClearPractice, with a release from the speaker; any style or feature can be targeted | Needs a speaker and a signed release; keep the release with the clip |
| NASA audio | Second line | US government media is generally not under US copyright; credit NASA | Commercial use of identifiable people (current astronauts and employees especially) needs permission; no endorsement, logos, or AI-training use. Fine for education, riskier for a product |
| Wikimedia Commons / Speech Wikimedia | Case by case | Many CC BY / CC BY-SA spoken files | CC BY-SA requires share-alike for derived clips; licences vary per file |

Not suitable: Mozilla Common Voice (CC0, but read single sentences and the datasets forbid re-hosting), and the Nyra benchmark clips used for M0 (evaluation data, not teaching material).

## Per-clip record (to keep next to each file)

```json
{
  "id": "ref-001",
  "file": "ref-001.ogg",
  "durationMs": 14200,
  "transcript": "…",
  "feature": "clear endings",
  "source": "VOA Learning English, <story title>",
  "sourceUrl": "https://learningenglish.voanews.com/…",
  "licence": "Public domain (VOA Learning English); credit required",
  "credit": "learningenglish.voanews.com",
  "checkedOn": "YYYY-MM-DD",
  "sha256": "…",
  "curriculumVersion": 1
}
```

## Sources consulted

- [VOA Learning English: Request Our Content](https://learningenglish.voanews.com/p/6861.html)
- [Georgetown University Library: open-access ESL/EFL](https://library.georgetown.edu/scholarly-communication/open-access-esl-efl)
- [LibriVox wiki: LibriVox and eBay (reuse of public-domain recordings)](https://wiki.librivox.org/index.php/LibriVox_and_Ebay)
- [NASA images and media usage guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)
- [Speech Wikimedia dataset](https://huggingface.co/datasets/MLCommons/speech-wikimedia)
- [Mozilla Common Voice Spontaneous Speech (English)](https://datacollective.mozillafoundation.org/datasets/cmihqzerk023co20749miafhq)
