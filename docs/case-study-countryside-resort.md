# Case study: Countryside Resort Gilgit

## Context

Countryside Resort Gilgit prepared a 300-item social campaign containing single-image posts, carousels, and reels. The editorial plan combined property marketing, guest reviews, regional destinations, seasonal tourism, festivals, and local sports.

Some tourism and event dates were stable. Others depended on later official announcements, so approving the entire campaign at once would have created a factual and operational risk.

## Implementation

- Media was organized in Drive by content format and post ID.
- A 17-column Sheet stored captions, schedules, approvals, platform states, remote IDs, verification, topics, and notes.
- A bound Apps Script checked eligible rows approximately every five minutes.
- Facebook and Instagram advanced independently.
- One row was approved first and verified on both public profiles.
- After that controlled test, 267 stable rows passed validation and were approved.
- Thirty-two variable-date rows remained `DRAFT` until their official dates could be reconfirmed.

## Operational result

Once enabled, the publisher could continue running with the operator's browser closed and computer offline. The Sheet gave the business a visible audit trail and prevented date-sensitive posts from becoming active prematurely.

## Lessons

- Approval gates are essential before bulk automation.
- Date verification is an operational dependency, not merely copy editing.
- Independent platform states make partial failures manageable.
- A successful API response should still be confirmed publicly during launch.
- A token with no scheduled expiry can still be revoked.
- A visible queue makes ownership and exceptions easier to manage than an opaque timer.

## Evidence boundary

This case study demonstrates publishing workflow and operational control. It does not claim guaranteed reach, engagement, bookings, or revenue.

Production credentials, internal account IDs, private state JSON, licensed photographs, guest-review text, and unpublished campaign copy are intentionally excluded from the repository.
