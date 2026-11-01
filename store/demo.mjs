/* demo data for the store screenshots: actions, notes and which tabs are open, tracker types and events, board tasks.
   sites are picked for their sharp 128px icons; Google's own subdomains (mail., drive., …) all get a generic "G" */

export const actions = [
  { type: "notes", name: "Notes" },
  { type: "tracker", name: "Tracker" },
  { type: "board", name: "Board" },
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

/* tracker: event times are minutes before the screenshot; an activity without an end is running */
export const trackerTypes = [
  { id: "wake-up", name: "Woke up", icon: "☀️" },
  { id: "coffee", name: "Coffee", icon: "☕" },
  { id: "water", name: "Water", icon: "💧" },
  { id: "deep-work", name: "Deep work", icon: "💻", span: true },
  { id: "workout", name: "Workout", icon: "🏋️", span: true },
  { id: "walk", name: "Walk", icon: "🚶", span: true },
  { id: "called-mom", name: "Called mom", icon: "📞" },
  { id: "vitamins", name: "Vitamins", icon: "💊" },
];

export const trackerEvents = [
  { type: "wake-up", ago: 300 },
  { type: "water", ago: 290 },
  { type: "workout", ago: 280, activity: "w1", phase: "start" },
  { type: "workout", ago: 245, activity: "w1", phase: "end" },
  { type: "vitamins", ago: 230 },
  { type: "coffee", ago: 225 },
  { type: "walk", ago: 150, activity: "k1", phase: "start" },
  { type: "walk", ago: 128, activity: "k1", phase: "end" },
  { type: "called-mom", ago: 110 },
  { type: "water", ago: 100 },
  { type: "coffee", ago: 95 },
  { type: "deep-work", ago: 83, activity: "d1", phase: "start" },
];

export const tasks = [
  { name: "Prepare slides for Thursday's demo", description: "10 slides max, live demo of the new onboarding", status: "work" },
  { name: "Fix flaky login test on CI", description: "fails about once in 20 runs, timing issue in the mock server", status: "work" },
  { name: "Book the car service", description: "Saturday morning if possible", status: "new" },
  { name: "Renew passport", description: "photos first", status: "new" },
  { name: "Order a birthday gift for Kate", description: "", status: "new" },
  { name: "Conference budget", description: "waiting for Mark's answer", status: "hold" },
  { name: "Reply to Anna about the Q4 roadmap", description: "", status: "done" },
  { name: "Review the pricing page copy", description: "", status: "done" },
  { name: "Pay the electricity bill", description: "", status: "done" },
];
