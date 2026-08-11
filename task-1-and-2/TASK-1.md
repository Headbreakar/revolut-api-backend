# Real-Time Notification System Design

## Part 1: Real-time notification system prompt

I'm building a real-time notification system for a construction project management
app. Stack: Node.js/Express, MongoDB (Mongoose), React frontend, Socket.io for
WebSockets, JWT-based auth already in place.

Domain: Tasks have multiple assigned users (stakeholders). When a task's status
changes, every assigned user should get a notification. Notifications have
read/unread state; users can mark individual notifications or all notifications
as read. Connected clients need the notification pushed in real time.

Help me design and implement, in this order:

1. Notification schema (fields + which fields need indexes and why)
2. A service function `notifyTaskStatusChange(task, changedBy)` that creates one
   notification per stakeholder, excludes the user who made the change, and avoids
   creating duplicates if this fires twice for the same event
3. REST endpoints: GET /notifications (paginated, filterable by read/unread),
   PATCH /notifications/:id/read, PATCH /notifications/read-all
4. Socket.io event contract: event names, payload shape, and how you'd handle a
   user connected from multiple devices/tabs (should all their sessions get the push?)
5. What happens when a stakeholder is offline at the moment the notification is
   created: how do they see it as unread when they reconnect, without a separate
   "replay missed events" system
6. Error handling: what happens if the DB write succeeds but the socket emit fails,
   and vice versa

Confirm or push back on these assumptions: single MongoDB instance (no sharding),
Socket.io rooms keyed by userId for delivery, notification recipients are only the
task's assignees plus the project owner: not the whole project team. If any of
these are naive for a system with hundreds of concurrent users, say so.

---

## Why structured this way

The scenario in the prompt names a tech stack explicitly instead of "build a notification system": vague stack means the model guesses and you get code you can't drop into your project. Numbering the six deliverables in a fixed order forces schema-first design, which is where most notification systems actually go wrong (denormalize recipient list into the notification doc vs. reference the task and join at read time: that decision cascades into everything downstream).

---

## What I'm specifically asking for

Not boilerplate CRUD: the hard parts: dedup logic (status change events can double-fire from retries), multi-device delivery, and the offline-user problem, which is the part people forget until a user complains their notification badge is wrong.

---

## Assumptions stated up front

Socket.io over raw WebSockets, single Mongo instance, recipient scope limited to assignees + owner. I put these in the prompt itself rather than letting the model silently pick: an AI assistant will happily assume "notify everyone on the project" if you don't constrain it, which is a different (and noisier) system.
