// The "AI Guide": instructions any AI (or person) can follow to write a course in our import format.
import type { CourseCategory } from './category';
import { LIMITS } from './course';

export const EXAMPLE_COURSE = {
  title: 'English 1: Everyday basics',
  description: 'Greetings, introducing yourself and simple questions for daily life.',
  category: 'Languages',
  level: 'beginner',
  visibility: 'group',
  pack: { title: 'English', order: 1 },
  lessons: [
    {
      title: 'Saying hello',
      minutes: 15,
      content: '## Greetings\n\n- **Hello / Hi** — any time\n- **Good morning** — before noon\n\nPractise out loud with a friend.',
      links: [{ title: 'Greetings video', url: 'https://www.youtube.com/watch?v=example' }],
      images: [{ url: 'https://example.com/greetings.png', alt: 'People waving hello' }],
      exercises: [
        { type: 'mcq', prompt: 'What do you say at 9 a.m.?', choices: ['Good night', 'Good morning', 'Good evening'], answer: 1 },
        { type: 'checklist', prompt: 'Before the next lesson', items: ['Say hello to 3 people', 'Watch the video'] },
        { type: 'text', prompt: 'Write two sentences introducing yourself.', sample: 'Hi, I am Kim. I like games.' },
      ],
    },
  ],
};

export function importGuideMarkdown(categories: CourseCategory[]): string {
  const cats = categories.map((c) => `- \`${c.nameEn}\` (${c.nameTh})`).join('\n');
  return `# Balance Our Day — course import guide (for AI and people)

You are writing ONE course as JSON for the "Balance Our Day" learning page.
Reply with **only the JSON object** (no commentary, no code fences) unless the user asks otherwise.
Write in the language the user asks for (Thai is common); keys stay in English.

## Shape

\`\`\`
{
  "title":       string, required, ≤ ${LIMITS.title} chars
  "description": string, ≤ ${LIMITS.description} chars (1–3 sentences)
  "category":    string, one of the categories below (English or Thai name)
  "level":       "beginner" | "intermediate" | "advanced"   (default beginner)
  "visibility":  "group" (everyone in the group) | "private" (only me)   (default group)
  "coverUrl":    optional https image URL
  "pack":        optional { "title": string, "order": number ≥ 1 } — courses in a pack are taken in order
                 (e.g. pack "English": English 1 = order 1, English 2 = order 2). A new pack title creates the pack.
  "lessons": [   required, 1–${LIMITS.lessons}, in teaching order
    {
      "title":    string, required
      "minutes":  optional whole number 1–600 (estimated time)
      "content":  Markdown (headings, lists, **bold**, tables, code). ≤ ${LIMITS.content} chars
      "links":    optional [{ "title": string, "url": "https://…" }] — YouTube links become embedded players
      "images":   optional [{ "url": "https://…", "alt": string }]
      "exercises": optional, ≤ ${LIMITS.exercises} per lesson, any of:
        { "type": "mcq",       "prompt": string, "choices": [2–${LIMITS.choices} strings], "answer": index of the correct choice (0 = first) }
        { "type": "checklist", "prompt": string, "items": [1–${LIMITS.items} strings] }
        { "type": "text",      "prompt": string, "sample": optional example answer shown after the learner answers }
    }
  ]
}
\`\`\`

## Categories

${cats}

## Good courses

- Small lessons (10–30 minutes each), one idea per lesson, building on the previous one.
- Start each lesson with a one-line goal; end with a short recap.
- Use real, working URLs only. If unsure about a link, leave it out.
- Mix exercise types: an mcq to check understanding, a checklist for practice, a text prompt for reflection.
- For a series, make one course per level and put them in the same pack with increasing "order".

## Example

\`\`\`json
${JSON.stringify(EXAMPLE_COURSE, null, 2)}
\`\`\`

## How it is checked

The site validates the JSON and shows **errors** (must fix: missing title, unknown category, mcq answer out of range, bad URL…)
and **warnings** (fine to keep: new pack will be created, lesson without content…). The user can edit everything before saving.
`;
}
