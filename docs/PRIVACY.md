# Privacy and data handling

VoiceSync records a voice note in the browser and sends it to your server. Your server then sends data to the AI providers you configured. This page says exactly what goes where, so you can tell your users.

## What leaves your server
| Data | Sent to | When |
|---|---|---|
| The audio recording | The transcription provider (`TRANSCRIPTION_PROVIDER`) | Each time someone sends a voice note |
| The transcript text and the recording date and timezone | The extraction provider (`EXTRACTION_PROVIDER`) | Right after transcription |
| Saved tasks | Your Supabase project | Only after the user reviews and saves |

Nothing else is sent. The browser never talks to an AI provider, and provider keys never reach the browser.

## What VoiceSync keeps
- **Audio:** processed in memory and dropped. It is never written to disk or stored. The server refuses to start if `AUDIO_RETENTION_ENABLED=true`.
- **Transcripts:** stored with a task only when `STORE_TRANSCRIPTS=true`. Off by default.
- **Tasks:** stored in your Supabase project, scoped to the account that created them.
- **Logs:** the server logs request IDs and error codes. It does not log audio, transcripts or keys.

## What you still need to do
- **Read each provider's data terms.** Retention, training use, region and deletion rules differ by provider and by plan. VoiceSync cannot see or change them. Choose providers whose terms fit your customers' expectations.
- **Tell your users.** The review screen names the providers that handled each note. Your own privacy policy should say the same.
- **Plan deletion.** Deleting a task removes it from your database. It does not remove anything a provider may have retained under its own terms.
- **Add your own policy pages** (privacy policy, terms). This project does not ship legal text.

## Backups, retries and usage records
- **Backup provider:** if you configure one, a note can be sent to it when the main provider is down. The review screen tells the person when that happens. Choose a backup whose data terms you are happy with, because it is a second place user data can go.
- **Retries:** to avoid paying twice, the finished result of a note (including its transcript) is kept in server memory for 10 minutes per person, then dropped. A restart clears it.
- **Usage records:** each provider call is logged with the user ID, provider, model, token counts, audio length, timing and error code. Audio and transcripts are never in these records. Decide how long you keep them and delete old rows from `usage_events` on your own schedule.

## Changing providers
Admins can change providers in the Provider settings screen. The screen asks for confirmation and says that the change affects who processes users' data. Only provider and model names are saved, never keys. The server logs who changed providers (user ID and provider names, nothing else).

## Fallback
There is no automatic fallback between providers. Switching providers changes who sees your users' data, so it is always a deliberate setting change.
