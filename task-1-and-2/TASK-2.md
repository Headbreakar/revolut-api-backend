# Part 2: Code Generation with AI — MongoDB Aggregation Pipeline

## Scenario

Build a MongoDB aggregation pipeline for a project dashboard returning:

- Total projects by status (planning, active, completed, on-hold)
- Average project duration
- Projects that are overdue
- Budget utilization percentage per project

---

## 1. The Prompt

```
I need a MongoDB aggregation pipeline for a project dashboard. Collection: `projects`.

Schema:
{
  _id,
  name: String,
  status: 'planning' | 'active' | 'completed' | 'on-hold',
  startDate: Date,
  endDate: Date,          // planned end date
  actualEndDate: Date | null,   // set only when status becomes 'completed'
  budget: { allocated: Number, spent: Number }
}

Build a pipeline (or set of pipelines) returning:
1. Count of projects grouped by status
2. Average project duration in days (only for completed projects, using
   actualEndDate - startDate)
3. Overdue projects: endDate has passed and status isn't 'completed'
4. Budget utilization % per project: spent / allocated * 100

Requirements:
- Decide whether this should be one pipeline using $facet or separate pipelines run
  in parallel, and justify it — this dashboard gets hit on every page load
- Put $match as early as possible in each branch
- Handle allocated = 0 without dividing by zero
- Handle completed projects missing actualEndDate (bad historical data) without
  breaking the average
- Recommend indexes for this pipeline and explain what each supports
- Use Mongoose's .aggregate() syntax
- Show the error handling in the route handler, not just the pipeline

Assumptions to validate: "overdue" = endDate < now AND status != 'completed';
duration is only meaningful for completed projects; dates are stored as real Date
objects, not strings. Flag anything that looks like it'll break on real data.
```

### Why structured this way

Giving the exact schema up front is the single biggest lever here — the most common failure mode in AI-generated aggregation code is plausible-but-wrong field names (e.g. `budget.total` instead of `budget.allocated`), which compiles fine and silently returns garbage. Asking explicitly for the `$facet`-vs-separate-pipelines decision matters because it's a real architectural tradeoff, not a style choice, and forces justification rather than a default. Asking for indexes and error handling as named deliverables (not "also add error handling") is what actually gets them included — models tend to skip non-functional requirements unless they're itemized.

### What specific information is being asked for

- Exact schema shape, so field references in the generated pipeline are correct rather than guessed
- The architectural decision between one combined pipeline vs. several, with justification tied to query frequency
- Concrete null/zero-division handling for two named edge cases (missing `actualEndDate`, `allocated = 0`)
- Index recommendations tied to _why_, not just a list of `createIndex` calls
- Error handling at the route/application layer, not just inside the aggregation stages

### Assumptions being made (and flagged in the prompt itself)

- "Overdue" = `endDate < now AND status != 'completed'` — a different reasonable definition would ignore status entirely. This is a business logic decision disguised as a technical one, so it's called out rather than left for the model to silently pick.
- Duration is only meaningful for completed projects (in-progress projects don't have a real duration yet).
- Dates are stored as native `Date` objects, not ISO strings — if this is wrong, `$subtract` on dates silently produces nonsense instead of erroring.
- Mongoose is the driver in use, which affects syntax (`.aggregate()` vs. the native driver's `db.collection.aggregate()`).

---

## 2. The Response

### Pipeline

```javascript
// dashboard.aggregation.js
const now = new Date();

const dashboardPipeline = [
  {
    $match: {
      status: { $in: ["planning", "active", "completed", "on-hold"] },
    },
  },
  {
    $facet: {
      countsByStatus: [
        { $group: { _id: "$status", count: { $sum: 1 } } },
        { $project: { _id: 0, status: "$_id", count: 1 } },
      ],

      avgDuration: [
        {
          $match: {
            status: "completed",
            actualEndDate: { $ne: null },
            startDate: { $ne: null },
          },
        },
        {
          $addFields: {
            durationDays: {
              $divide: [
                { $subtract: ["$actualEndDate", "$startDate"] },
                1000 * 60 * 60 * 24,
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            avgDurationDays: { $avg: "$durationDays" },
            projectsCounted: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            avgDurationDays: { $round: ["$avgDurationDays", 1] },
            projectsCounted: 1,
          },
        },
      ],

      overdueProjects: [
        {
          $match: {
            status: { $ne: "completed" },
            endDate: { $lt: now },
          },
        },
        {
          $project: {
            name: 1,
            status: 1,
            endDate: 1,
            daysOverdue: {
              $round: [
                {
                  $divide: [
                    { $subtract: [now, "$endDate"] },
                    1000 * 60 * 60 * 24,
                  ],
                },
                0,
              ],
            },
          },
        },
        { $sort: { daysOverdue: -1 } },
      ],

      budgetUtilization: [
        {
          $project: {
            name: 1,
            status: 1,
            allocated: { $ifNull: ["$budget.allocated", 0] },
            spent: { $ifNull: ["$budget.spent", 0] },
          },
        },
        {
          $addFields: {
            utilizationPct: {
              $cond: [
                { $eq: ["$allocated", 0] },
                null, // no allocated budget -> percentage is undefined, not 0 or Infinity
                {
                  $round: [
                    { $multiply: [{ $divide: ["$spent", "$allocated"] }, 100] },
                    1,
                  ],
                },
              ],
            },
          },
        },
        { $sort: { utilizationPct: -1 } },
      ],
    },
  },
];

module.exports = dashboardPipeline;
```

### Route handler

```javascript
const Project = require("../models/Project");
const dashboardPipeline = require("./dashboard.aggregation");

router.get("/dashboard", async (req, res) => {
  try {
    const [result] = await Project.aggregate(dashboardPipeline);

    // $facet always returns arrays even when empty — fill in zero-count statuses
    // so the frontend doesn't have to special-case missing keys
    const statuses = ["planning", "active", "completed", "on-hold"];
    const countsByStatus = statuses.map((status) => {
      const found = result.countsByStatus.find((s) => s.status === status);
      return { status, count: found ? found.count : 0 };
    });

    res.json({
      countsByStatus,
      avgDuration: result.avgDuration[0] || {
        avgDurationDays: null,
        projectsCounted: 0,
      },
      overdueProjects: result.overdueProjects,
      budgetUtilization: result.budgetUtilization,
    });
  } catch (err) {
    console.error("Dashboard aggregation failed:", err);
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
});
```

### Indexes

```javascript
db.projects.createIndex({ status: 1, endDate: 1 }); // supports overdue query + status grouping (status is a prefix)
db.projects.createIndex({ status: 1, actualEndDate: 1 }); // supports the completed-project duration $match
```

The single-field `{ status: 1 }` index is redundant once the compound index exists — Mongo can use a compound index's leading field alone, so there's no need to create both.

| Index                             | Supports                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| `{ status: 1, endDate: 1 }`       | `countsByStatus` grouping, and the `overdueProjects` `$match` on `status` + `endDate`             |
| `{ status: 1, actualEndDate: 1 }` | The `avgDuration` branch's initial `$match` on `status: 'completed'` and non-null `actualEndDate` |

---

## 3. Error Handling — Where It Actually Lives

| Concern                                                          | Handled by                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Missing `budget.allocated` / `budget.spent`                      | `$ifNull` — defaults to `0` instead of erroring on missing subdocument fields                                                      |
| Divide-by-zero on `allocated = 0`                                | `$cond` returns `null` explicitly rather than relying on Mongo's implicit behavior, which is more predictable                      |
| Completed projects missing `actualEndDate` (bad historical data) | Excluded via `$match` (`actualEndDate: { $ne: null }`) before the duration is computed, so one bad record can't poison the average |
| Connection / query failure                                       | try/catch at the route level — the pipeline itself can't catch its own connection errors, this has to live in the handler          |
| Empty result set for a given status                              | Route handler backfills all four statuses to `0` since `$group` only returns statuses that actually appear in the data             |

---

## 4. Architectural Note: `$facet` Tradeoff

All four sub-pipelines share the _initial_ `$match` result set in memory, but each branch's own internal `$match` and `$sort` stages don't get index support the way a standalone `.aggregate()` call would — Mongo can't push those down through the facet boundary. For a small-to-mid sized `projects` collection this is fine, and one round trip is simpler to maintain and reason about.

If the collection grows into the hundreds of thousands of documents and this dashboard is hit frequently, running the four pipelines as separate `Project.aggregate()` calls via `Promise.all` would let each one hit its own index properly, at the cost of four round trips instead of one. This is worth measuring against real data volume rather than deciding upfront — the `$facet` version is the right default until there's a reason to split it.
