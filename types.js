/* JSDoc type definitions for Soulmask Clan Manager.
 *
 * This file is loaded into the browser as a no-op script (the only
 * runtime export is `void 0`); its job is purely to give VS Code's
 * TypeScript server something to work with. Hover any property on
 * state.roster[0] / state.plans[0].steps[0] / etc and you'll get a
 * typed signature. JSDoc references in app.js (e.g. @param {Tribesman}
 * t) resolve against the typedefs declared here.
 *
 * Why a separate file: keeps the ~150-line type block out of app.js,
 * and means we can extend it without touching the main code path.
 *
 * To turn on strict checking later, add `// @ts-check` to the top of
 * app.js (or set `"checkJs": true` in jsconfig.json).
 */

/**
 * @typedef {Object} SkillCell
 * @property {number|null} current
 * @property {number|null} cap
 */

/**
 * @typedef {Object} WeaponCell
 * @property {number|null} current
 * @property {number|null} cap
 */

/**
 * @typedef {Object} Talent
 * @property {string} name - matches a TalentMeta.name in the catalog
 * @property {number} level - 1, 2, or 3
 * @property {string} [icon] - icon filename (mirrored from catalog)
 */

/**
 * @typedef {"Craftsman"|"Porter"|"Laborer"|"Warrior"|"Hunter"|"Guard"|""} Profession
 */

/**
 * @typedef {Object} Tribesman
 * @property {string} id - "T_" prefix
 * @property {string} name
 * @property {number|null} level
 * @property {string} title
 * @property {Profession} profession
 * @property {string} tribe
 * @property {string} trait
 * @property {string} location
 * @property {boolean} is_body
 * @property {Object<string, SkillCell>} skills
 * @property {Object<string, WeaponCell>} weapons
 * @property {Object<string, number|null>} attrs
 * @property {Talent[]} talents
 * @property {string[]} groups
 * @property {string[]} tags
 * @property {string} notes
 * @property {Object} [recognition]
 */

/** @typedef {"draft"|"active"|"done"|"abandoned"} PlanStatus */
/** @typedef {"queued"|"running"|"completed"|"abandoned"} StepStatus */
/** @typedef {"cap-raise"|"learn"|"upgrade"} StepType */
/** @typedef {1|2|3|4|5} MaterialTier */

/**
 * @typedef {Object} TrainingStep
 * @property {string} id - "S_" prefix
 * @property {StepType} type
 * @property {string|null} mentorId
 * @property {string|null} weapon - present for cap-raise (and weapon-gated talents in upgrade)
 * @property {string|null} talent - present for upgrade and (optionally) learn
 * @property {number|null} targetCap - cap-raise stop value
 * @property {number|null} targetLevel - upgrade target Lv (2 or 3)
 * @property {MaterialTier} material - 1-5: Beast Hide → Endgame
 * @property {StepStatus} status
 * @property {string|null} startedAt - ISO date
 * @property {string|null} completedAt - ISO date
 * @property {number|null} actualDurationMin - filled in once known, drives auto-fit later
 * @property {string|null} [appliedAt] - ISO date when the step's outcome was pushed to the trainee's data
 * @property {string} note
 */

/**
 * @typedef {Object} TrainingPlan
 * @property {string} id - "P_" prefix
 * @property {string} name
 * @property {string} traineeId - tribesman id
 * @property {PlanStatus} status
 * @property {string} createdAt - ISO date
 * @property {string} notes
 * @property {TrainingStep[]} steps
 */

/**
 * @typedef {Object} TrainingSuggestion
 * @property {StepType} type
 * @property {string} [weapon]
 * @property {string} [talent]
 * @property {number} [currentCap]
 * @property {number} [targetCap]
 * @property {number} [ceiling]
 * @property {number} [currentLevel]
 * @property {number} [targetLevel]
 * @property {string[]} mentorIds - ordered, top candidate first
 * @property {number} [availableCount] - learn: total learnable talent count
 * @property {number} [positiveCount] - learn: trainee's current positive talent count
 * @property {string} head - HTML
 * @property {string} why - HTML
 */

/**
 * @typedef {Object} Calibration
 * @property {Object<string, number>} baseTimes
 * @property {Object<string, number>} tierMultipliers
 */

/**
 * @typedef {Object} TalentMeta
 * @property {string} name
 * @property {string|null} cn_name
 * @property {string} category
 * @property {string} type
 * @property {string} effect
 * @property {string|null} lock
 * @property {string|null} prereq
 * @property {string} icon
 * @property {string} icon_url
 * @property {"positive"|"negative"} polarity
 */

/**
 * @typedef {Object} SortState
 * @property {string|null} column
 * @property {"asc"|"desc"|null} dir
 * @property {string|null} sub - sub-column for skills (current|cap)
 */

/**
 * @typedef {Object} AppState
 * @property {Tribesman[]} roster
 * @property {TalentMeta[]} talents
 * @property {string[]} groups
 * @property {string[]} tags
 * @property {TrainingPlan[]} plans
 * @property {Calibration} calibration
 * @property {string|null} selectedId
 * @property {string|null} selectedPlanId
 * @property {SortState} sort
 * @property {string[]} lastRosterOrder
 */
