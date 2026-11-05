/* demo data for the store screenshots: actions, notes and which tabs are open, tracker types and entries, board
   tasks (scripts/release.mjs turns them into records). sites are picked for their sharp 128px icons; Google's own
   subdomains (mail., drive., …) all get a generic "G" */

export const actions = [
  { name: "Notes", url: "#/notes" },
  { name: "Tracker", url: "#/tracker" },
  { name: "Board", url: "#/board" },
  { name: "GitHub", url: "https://github.com" },
  { name: "Stack Overflow", url: "https://stackoverflow.com" },
  { name: "ChatGPT", url: "https://chatgpt.com" },
  { name: "Claude", url: "https://claude.ai" },
  { name: "Notion", url: "https://www.notion.so" },
  { name: "Figma", url: "https://www.figma.com" },
  { name: "YouTube", url: "https://www.youtube.com" },
  { name: "Wikipedia", url: "https://en.wikipedia.org" },
  { name: "Reddit", url: "https://www.reddit.com" },
];

export const notes = {
  "todo.md": `# This week

## Work
- [x] Review the pricing page copy
- [x] Reply to Anna about the Q4 roadmap
- [ ] Prepare slides for Thursday's demo
- [ ] Fix flaky login test on CI
- [ ] 1:1 with Mark — ask about the conference budget

## Home
- [ ] Book the car service (Saturday morning?)
- [ ] Renew passport — photos first
- [x] Pay the electricity bill
- [ ] Order a birthday gift for Kate

## Read later
- "Designing Data-Intensive Applications", ch. 5
- The article about local-first software
- Release notes for the new Chrome version

## Ideas
- Weekly review every Friday, 30 min
- Keep one note per project, close tabs when done
`,
  "meeting-notes.txt": `Product sync — Tuesday

Attendees: Anna, Mark, Lisa, me

1. Onboarding funnel
   - drop-off on step 3 is still around 40%
   - Lisa will test a shorter form with 2 fields instead of 5
   - decision by next Tuesday

2. Mobile release
   - build is ready, waiting for the store review
   - release notes: Mark, by Wednesday

3. Hiring
   - two candidates for the frontend role, final interviews this week
   - I'm on the panel for Thursday 14:00

Action items
- Anna: share the funnel dashboard with the team
- Lisa: A/B test plan
- me: feedback on the release notes, book the room for the demo
`,
  "ideas.md": `# Side project ideas

- A tiny CLI that renames photos by EXIF date
- Weekly newsletter digest: one email instead of twenty
- Plant watering reminder with a soil sensor
`,
  "deploy.sh": `#!/bin/sh
set -e
npm ci
npm run build
rsync -av --delete dist/ server:/var/www/app/
ssh server 'systemctl reload nginx'
echo "deployed $(git rev-parse --short HEAD)"
`,
  "shopping.txt": `milk
eggs
coffee beans
pasta, tomatoes, basil
batteries (AA)
`,
  "books.txt": `The Pragmatic Programmer
A Philosophy of Software Design
Thinking, Fast and Slow
`,
};

export const openTabs = ["todo.md", "meeting-notes.txt", "ideas.md", "deploy.sh"];

/* tracker: types by a key used below; entries start `ago` minutes before the screenshot, activities last `minutes`
   (null = still running) */
export const trackerTypes = [
  { key: "wake-up", name: "Woke up", icon: "☀️", kind: "event" },
  { key: "coffee", name: "Coffee", icon: "☕", kind: "event" },
  { key: "water", name: "Water", icon: "💧", kind: "event" },
  { key: "deep-work", name: "Deep work", icon: "💻", kind: "activity" },
  { key: "workout", name: "Workout", icon: "🏋️", kind: "activity" },
  { key: "walk", name: "Walk", icon: "🚶", kind: "activity" },
  { key: "called-mom", name: "Called mom", icon: "📞", kind: "event" },
  { key: "vitamins", name: "Vitamins", icon: "💊", kind: "event" },
];

export const trackerEntries = [
  { type: "wake-up", ago: 300 },
  { type: "water", ago: 290 },
  { type: "workout", ago: 280, minutes: 35 },
  { type: "vitamins", ago: 230 },
  { type: "coffee", ago: 225 },
  { type: "walk", ago: 150, minutes: 22 },
  { type: "called-mom", ago: 110 },
  { type: "water", ago: 100 },
  { type: "coffee", ago: 95 },
  { type: "deep-work", ago: 83, minutes: null },
];

export const tasks = [
  { name: "Prepare slides for Thursday's demo", description: "10 slides max, live demo of the new onboarding", status: "work" },
  { name: "Fix flaky login test on CI", description: "fails about once in 20 runs, timing issue in the mock server", status: "work" },
  { name: "Book the car service", description: "Saturday morning if possible", status: "new" },
  { name: "Renew passport", description: "photos first", status: "planned" },
  { name: "Order a birthday gift for Kate", description: "", status: "new" },
  { name: "Conference budget", description: "waiting for Mark's answer", status: "hold" },
  { name: "Reply to Anna about the Q4 roadmap", description: "", status: "done" },
  { name: "Review the pricing page copy", description: "", status: "done" },
  { name: "Pay the electricity bill", description: "", status: "done" },
];
