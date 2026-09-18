# Operations runbook

## Before approving a batch

1. Pause automatic posting before a large structural edit.
2. Confirm the spreadsheet and publisher timezones.
3. Verify every `publish_at` value uses the accepted format.
4. Recheck seasonal, festival, tournament, and other variable dates.
5. Confirm every media path and carousel order.
6. Run **Validate approved rows**.
7. Run **Preview next action**.
8. Confirm there is only one active publisher for this queue.
9. Resume automatic posting.
10. Inspect the first public post in the batch on both platforms.

## Routine checks

Weekly:

- filter for `REVIEW`, `MISSED`, or unequal platform statuses
- confirm the installable trigger still exists
- review Apps Script executions and quota usage
- verify Page and Instagram access still works
- reconfirm approaching variable event dates
- check whether the pinned Meta Graph API version needs migration
- review who can edit the Sheet, script, and Drive folder

## Pause and resume

Pausing removes the scheduled trigger and blocks future checks. It does not undo published content and cannot cancel a request already accepted by Meta.

Before resuming after an incident:

1. inspect both public profiles
2. preserve successful platform state and remote IDs
3. fix the underlying media, schedule, permission, or credential issue
4. validate the affected rows
5. preview the next action
6. resume and monitor the next trigger execution

## When a row reaches REVIEW

1. Pause posting if the error could affect more than one row.
2. Record the `post_id`, both statuses, both remote IDs, and `last_error`.
3. Check Facebook and Instagram publicly.
4. Check Apps Script **Executions** for the matching time.
5. Determine whether Meta may have accepted the request.
6. Do not clear state or repeat a publication until duplicate risk is resolved.
7. If a manual repair is necessary, change only the affected platform.

## Token maintenance

Do not replace a non-expiring Page token on an arbitrary 60-day schedule solely because user tokens often expire. Monitor actual access and reconnect after:

- Page or Business Portfolio role changes
- Facebook password or security changes
- Instagram-to-Page linkage changes
- app ownership, mode, or permission changes
- token revocation or suspected exposure

## Graph API upgrades

The default API version is pinned in `appsscript/Config.gs`. Before changing it:

1. read the official changelog
2. test connection, one image, one carousel, and one Reel in a non-production queue
3. verify response fields used by the state machine
4. update tests and documentation
5. release the change with migration notes

## Archiving

This release supports up to 1,000 active queue rows. Archive completed rows by copying them, including F:N, into a restricted historical workbook. Never reuse archived `post_id` values.
