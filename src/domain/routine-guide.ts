// The routine import guide for AI and people (exercises, meals, workout plans, meal plans).
import { MEAL_TYPES, MUSCLES, RLIMITS, WORKOUT_SECTIONS } from './routine';

export const EXAMPLE_ROUTINES = {
  items: [
    { kind: 'exercise', title: 'Push-up', muscles: ['chest', 'arms', 'core'], equipment: 'none', sets: 3, reps: '8-12',
      instructions: '1. Hands under shoulders, body in a straight line\n2. Lower until the chest is just above the floor\n3. Push back up\n\n**Easier:** knees on the floor.' },
    { kind: 'exercise', title: 'Bodyweight squat', muscles: ['legs', 'glutes'], equipment: 'none', sets: 3, reps: '15',
      instructions: '1. Feet shoulder-width apart\n2. Sit back and down, knees follow the toes\n3. Stand up through the heels' },
    { kind: 'exercise', title: 'Plank', muscles: ['core'], equipment: 'none', sets: 3, seconds: 30,
      instructions: 'Forearms on the floor, body straight from head to heels. Do not let the hips drop.' },
    { kind: 'meal', title: 'Greek yogurt with banana', mealTypes: ['breakfast', 'snack'], serving: '1 bowl',
      calories: 250, protein: 18, carbs: 35, fat: 4, ingredients: ['200 g plain Greek yogurt (low fat)', '1 banana', '1 tsp honey'],
      steps: 'Slice the banana onto the yogurt and add honey.' },
    { kind: 'meal', title: 'Grilled chicken breast with rice', mealTypes: ['lunch', 'dinner'], serving: '1 plate',
      calories: 520, protein: 45, carbs: 60, fat: 10, ingredients: ['150 g chicken breast', '1 cup cooked jasmine rice', 'Cucumber, tomato'],
      steps: '1. Season the chicken with salt, pepper and garlic\n2. Grill 5–6 min per side\n3. Serve with rice and vegetables',
      prepMinutes: 10, cookMinutes: 12, makes: 1, tools: ['grill pan'], tips: 'Rest the chicken 3 minutes before slicing so it stays juicy.' },
  ],
  plans: [
    { kind: 'workout', title: 'Beginner full body A', description: '20–25 minutes, no equipment',
      entries: [
        { section: 'warmup', item: 'Bodyweight squat', sets: 1, reps: '10', note: 'slow' },
        { section: 'main', item: 'Push-up', sets: 3, reps: '8-12', rest: 60 },
        { section: 'main', item: 'Bodyweight squat', sets: 3, reps: '15', rest: 60 },
        { section: 'main', item: 'Plank', sets: 3, seconds: 30, rest: 45 },
      ] },
    { kind: 'meal', title: 'Workday high-protein day', description: 'About 1,500 kcal',
      entries: [
        { section: 'breakfast', item: 'Greek yogurt with banana' },
        { section: 'lunch', item: 'Grilled chicken breast with rice' },
        { section: 'dinner', item: 'Grilled chicken breast with rice', servings: 1 },
        { section: 'snack', item: 'Greek yogurt with banana', servings: 0.5 },
      ] },
  ],
};

export function routineGuideMarkdown(): string {
  return `# Balance Our Day — routine import guide (exercises, meals, workout plans, meal plans)

You are writing routines as JSON for the "Balance Our Day" site. Reply with **only the JSON object** unless the user asks otherwise.
Write titles and text in the language the user asks for (Thai is common); keys and enum values stay in English.

## Shape

\`\`\`
{
  "items": [   // the library: reusable exercises and meals (≤ ${RLIMITS.items})
    // exercise
    { "kind": "exercise", "title": string (required, unique in this import),
      "muscles": [${MUSCLES.map((m) => `"${m}"`).join(' | ')}],
      "equipment": string, "sets": 1–20, "reps": string like "10" or "8-12", "seconds": for timed moves,
      "instructions": Markdown (how to do it safely, easier/harder versions),
      "description": short text, "images": [{ "url", "alt" }], "links": [{ "title", "url" }] (YouTube links play in the page),
      "visibility": "group" | "private" }
    // meal
    { "kind": "meal", "title": string, "mealTypes": [${MEAL_TYPES.map((m) => `"${m}"`).join(' | ')}],
      "serving": what one serving is, e.g. "1 plate",
      "calories": kcal per serving, "protein" / "carbs" / "fat": grams per serving,
      "ingredients": [strings with amounts], "steps": Markdown numbered list (one action per step, with times and heat),
      "prepMinutes" / "cookMinutes": numbers, "makes": how many servings the recipe makes (amounts are for that many),
      "tools": ["air fryer", ...], "tips": Markdown (swaps, storage, how to keep it tender),
      "description", "images", "links", "visibility" }
  ],
  "plans": [   // ≤ ${RLIMITS.plans}
    { "kind": "workout" | "meal", "title": string, "description": string, "visibility": "group" | "private",
      "entries": [   // in order, ≤ ${RLIMITS.entries}
        { "section": workout: ${WORKOUT_SECTIONS.map((s) => `"${s}"`).join(' | ')} · meal: ${MEAL_TYPES.map((s) => `"${s}"`).join(' | ')},
          "item": title of an item (from "items" above or already in the library), or "itemId": number,
          workout: "sets", "reps", "seconds", "rest" (seconds between sets) · meal: "servings" (default 1),
          "note": optional }
      ] }
  ]
}
\`\`\`

A meal plan is **one day** of eating. The site adds up calories and protein/carbs/fat per day.
A workout plan is **one session**. People link plans to days of their week (and optionally an hour) themselves.

## Good routines

- Calories and macros must be realistic and consistent (protein×4 + carbs×4 + fat×9 ≈ calories). Use common portion sizes.
- Prefer Thai-friendly meals and ingredients when the user is in Thailand.
- Workouts: include a warm-up and an easier option; keep beginner sessions 20–40 minutes.
- Only real, working URLs. If unsure, leave links out.
- This is general guidance, not medical advice.

## Example

\`\`\`json
${JSON.stringify(EXAMPLE_ROUTINES, null, 2)}
\`\`\`
`;
}
