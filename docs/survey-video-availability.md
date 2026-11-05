# El Reno Survey video availability

Checked November 5, 2026 using public provider metadata and the original project/research pages. No video files were downloaded, and metadata success is not proof of playback.

The bundled survey metadata points to 33 legacy Vimeo publications. Direct oEmbed checks returned HTTP 404 for 32. The Hallen entry returned HTTP 200 with a generic iframe response but no title or creator metadata; it was not verified playable. These results support removing the legacy player links, but do not establish whether the underlying recordings were deleted, made private, or restricted.

No official migration notice or verified replacement for the synchronized archive was found in this bounded search. The [original Tornado Environment Display](https://el-reno-survey.net/ted/) remains published. The [Allen Research Group's project page at Central Michigan University](https://people.se.cmich.edu/allen4jt/allen_pastprojects_elreno.html) still links that display and describes a separate research archive. The [project's news page](https://el-reno-survey.net/category/new/) offers no replacement location; its latest visible dated entry is from May 2014. These pages establish the archive's history, not the current availability of its original video files.

Six existing creator YouTube publications in `data/videos.json` again returned HTTP 200 with title and creator metadata: Dan Robinson, Skip Talbot, Nick Nolte, Brandon Sullivan, Chris Kridler, and Pecos Hank. Ben Holcomb's survey-linked YouTube publication returned HTTP 403 and remains excluded from playable embeds. The [survey participant list](https://el-reno-survey.net/participants/) is a useful source of creator references, but an alternate upload or edit must not inherit a legacy survey video's clock alignment.

The [original call for data](https://el-reno-survey.net/call-for-data/) identifies Anton Seimon and John Allen as project leads and publishes the survey contact address. Asking the archive custodians about the original synchronized exports is the supported next recovery route; no outreach was performed. No replacement archive URL has been invented or substituted.

The local research evidence is `.local/survey-video-availability.json` (excluded from Git), containing the check time, original URLs, HTTP statuses, and returned provider metadata. Firecrawl was unavailable because its account had no remaining credits; research continued using web search and direct public metadata requests.
