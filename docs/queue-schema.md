# Publishing Queue schema

The publisher requires the exact headers and order below in columns A:Q.

| Column | Field | Owner | Purpose |
| --- | --- | --- | --- |
| A | `post_id` | Editor | Unique, stable post key |
| B | `media_files` | Editor | Relative Drive paths; use `\|` between carousel items |
| C | `caption` | Editor | Plain-text caption; line breaks are preserved |
| D | `publish_at` | Editor | `YYYY-MM-DD HH:mm` in the configured timezone |
| E | `approval` | Editor | `DRAFT` or `APPROVED` |
| F | `facebook_status` | Publisher | Facebook progress |
| G | `instagram_status` | Publisher | Instagram progress |
| H | `facebook_state` | Publisher | Machine-readable recovery state |
| I | `instagram_state` | Publisher | Machine-readable recovery state |
| J | `last_error` | Publisher | Most recent actionable error |
| K | `format` | Editor | `Single image`, `Carousel`, or `Reel` |
| L | `reel_cover_filename` | Editor | Optional relative JPEG cover path |
| M | `facebook_post_id` | Publisher | Confirmed Facebook remote ID |
| N | `instagram_post_id` | Publisher | Confirmed Instagram remote ID |
| O | `verification` | Editor | Research and date-safety status |
| P | `topic` | Editor | Editorial classification and fallback alt text |
| Q | `notes` | Editor | Internal notes only; never published |

## Editorial rules

- Never reuse a `post_id`, even after archiving a row.
- A caption is plain text, not Markdown or HTML.
- `00:00` means midnight.
- Change time, caption, media, or format while a row is `DRAFT` and before preparation begins.
- Do not edit F:N manually unless following a documented incident-recovery procedure.
- Do not clear one platform merely because the other failed.
- Carousel order follows the left-to-right order in `media_files`.
- Relative paths are resolved one folder segment at a time under the configured Drive root.

## Approval values

| Value | Behavior |
| --- | --- |
| `DRAFT` | Never starts new remote work |
| `APPROVED` | Eligible when all validation and timing checks pass |

Changing an in-flight row back to `DRAFT` prevents new work but does not suppress verification of a publication that Meta may already have accepted.

## Verification values

| Value | Intended use |
| --- | --- |
| `VERIFIED` | Stable, reviewed content |
| `VERIFIED; VARIABLE DATES FLAGGED` | Event or seasonal date still needs official confirmation; publishing is blocked |
| `VERIFIED; DATE RECONFIRMED` | Variable date was rechecked against a current official source |

## Visible platform statuses

| Status | Meaning |
| --- | --- |
| `PENDING` | No remote preparation has started |
| `PREPARING` | A container or staged image is being prepared |
| `UPLOADING` | A Reel is awaiting or receiving bytes |
| `PROCESSING` | Meta is processing media |
| `READY` | Media is prepared and waiting for its due time |
| `PUBLISHING` | Publication was submitted or is being verified |
| `PUBLISHED` | The platform publication is confirmed |
| `REVIEW` | Automatic work stopped for human review |
| `MISSED` | The late threshold passed without safe publication |
| `DISABLED` | Publishing to this platform is intentionally disabled |

## State JSON

H and I are durable machine state. A typical object can include:

```json
{
  "step": "READY",
  "signature": "9d4b...",
  "updated_at": "2026-09-18T10:00:00.000Z",
  "operation_id": "uuid",
  "remote_id": "123456789",
  "photo_ids": ["123"],
  "children": ["456"],
  "ready_children": ["456"],
  "poll_count": 0
}
```

Do not hand-edit state JSON casually. It is the publisher's main duplicate-prevention and recovery record.

If an Instagram publish succeeds immediately before the response is lost, later container verification can confirm `PUBLISHED` without recovering the media ID returned by the original `media_publish` call. In that narrow case column N remains blank and state records `published_id_unavailable: true`; do not invent an ID or replay publication.
