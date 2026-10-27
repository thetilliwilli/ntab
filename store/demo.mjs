/* demo data for the store screenshots: actions, notes and which tabs are open.
   sites are picked for their sharp 128px icons; Google's own subdomains (mail., drive., …) all get a generic "G" */

export const actions = [
  { type: "notes", name: "Notes" },
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
