---
type: task-tree
title: Website Redesign
description: Q3 marketing-site rebuild — a worked Task Tree board.
tags: [project, marketing]
timestamp: 2026-07-19T14:30:00Z
---

- [/] Design ^t-design
	- [x] Moodboard ^t-moodboard
	- [/] Wireframes ^t-wireframes
		- [x] Home page ^t-wf-home
		- [ ] Pricing page ^t-wf-pricing
	- Notes: keep the visual language minimal
- [!] Content ^t-content
	- [!] Copywriting (waiting on brand sign-off) ^t-copy
	- [ ] Photography ^t-photo
	- [-] Customer video ^t-video
- [x] Infrastructure [tt-override:: done] ^t-infra
	- [x] Domain + DNS ^t-domain
	- [ ] Staging box ^t-staging
- [ ] Launch ^t-launch
	- [ ] QA pass [tt-blocked-by:: t-staging] ^t-qa
	- [ ] Announcement post [tt-blocked-by:: t-qa, t-copy] ^t-announce
