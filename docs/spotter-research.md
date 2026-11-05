# Chaser locations and video evidence

Checked November 4, 2026. The project now contains 33 named camera tracks and 913 distinct timestamp/coordinate observations from the **primary El Reno Survey archive**. These are survey camera positions, not historical Spotter Network transmissions. The separate `GPS.json` remains the source for Shane Motley's chase.

## Recovered primary dataset

- Public display: <https://el-reno-survey.net/ted/>
- Original data: <https://el-reno-survey.net/ted/ted-elreno-metadata.js>
- Retrieved URL: <https://el-reno-survey.net/ted/ted-elreno-metadata.js?download=1>
- Original bytes: 147,803.
- SHA-256: `529691b0c0639e912864b55b2b305a85a15a645d204f8e926b99ab635ecfd0b2`.
- Methodology: [Seimon et al. (2016), Crowdsourcing the El Reno 2013 Tornado](https://doi.org/10.1175/BAMS-D-15-00174.1).
- Research-group description: <https://people.se.cmich.edu/allen4jt/allen_pastprojects_elreno.html>.

The metadata includes date/time, latitude, longitude, up to three camera azimuths, and an associated Vimeo identifier for each contributor. Its 33 source labels are Ahlgrim/Ruesink, Bartlett, Bowling, Casey, Deligny/Asselin, Engquist, Farrar/Demko, Faubion, Gribble/Goltl, Gwyn, Hallen, Hannon, Hendrickson, Hines, Holcomb, Lingl, Marshall, McMillan, Nelson, Pfister/Kaser, Potter, Rhinehart, Robinson, Sampson, Schyma, Seimon, Shaw, Snyder, Sullivan, Talbot, Weingart, Wilburn and Watts. Original surnames/group labels are retained unless a full name was corroborated by the creator's account or published research.

The source was read as text. Array literals were converted to JSON; the downloaded JavaScript was **not executed**. All source `Z` timestamps remain UTC. Oklahoma daylight time on this date is UTC−5; no additional local timezone offset belongs in parsing. Coordinate digits are preserved without claiming corresponding physical precision.

The public survey project describes georeferencing from GPS records and geographic evidence, with clock correction from lightning. The metadata does not provide numeric position or timing uncertainties for each observation. Camera azimuth describes viewing direction, not vehicle heading. These sparse observations do not establish a continuously measured driving route, and interpolated positions must be labeled as estimates. The data recommends a maximum interpolation gap of 120 seconds and explicitly marks one implausible movement interval.

## Data checks and retained limitations

There were 918 original rows. Three were excluded from map positions: Lingl at 22:52:08Z has a null latitude; Potter at 23:14:48Z has a null latitude and longitude 190; Talbot at 23:13:27Z has latitude `.449887`, far outside Oklahoma. No missing latitude prefix was guessed. Original excluded values are preserved in `spotters.json` provenance.

Two repeated timestamp/coordinate rows from Hendrickson were merged. One repeated position had different camera bearings, 280° and 310°; both are preserved as candidates, and the single bearing is null. Rhinehart's rows were sorted by UTC because the source contains an out-of-order entry.

Hannon's observations at 23:16:41Z and 23:17:00Z imply movement of approximately 1.918 km in 19 seconds, about 226 mph. Both source observations are retained, with a `breakIntervals` record. Do not interpolate through that interval or use it to infer a vehicle speed. Displaying an exact source observation does not resolve its accuracy.

## Spotter Network and TWISTEX status

The survey paper describes consulting Spotter Network archives when assembling its contributors. Its publicly recovered metadata contains no name or identifier match for Motley, `smotley`, public Spotter Network ID `5867`, Samaras or TWISTEX. It does not establish that these people were absent from the chase or network.

A coarse comparison against `GPS.json` used survey observations within 30 seconds of a GPS fix and required at least five pairs per track. The smallest median separation was approximately 2.31 km for Hannon, across 25 pairs. That is not a plausible match of the same vehicle. No survey contributor has been relabeled as Shane.

The [Spotter Network feeds page](https://www.spotternetwork.org/feeds.php) documents current feeds, and an [older premium page](https://www.spotternetwork.org/pro.php) mentions position-history downloads. Neither supplied a public May 31, 2013 historical export during this search. Searches covered the service, the El Reno Survey/AMS study and TED display, researcher pages, public GitHub material, Zenodo indexing, Stormtrack discussions and individual chaser sites. No authenticated account or secret application identifier was used.

Dan Robinson's [June 29, 2013 Stormtrack post](https://stormtrack.org/threads/2013-05-31-event-ks-ok-mo-il.26811/page-14) publishes a GPS log at <https://stormhighway.com/may312013/elreno.gpl> and event chronology at <https://stormhighway.com/may312013/elrenosequence-forrelease.csv>. Direct reads returned HTTP 403; his former event report now redirects to a site closure page. These files were not imported. The TED primary dataset independently supplies 43 Robinson observations.

The primary metadata endpoint initially returned HTTP 406 to Python/default requests. A normal curl request with a current browser user agent, the TED page as Referer, and the `?download=1` URL returned the complete file. Its byte hash matched the independently recorded hash in [this public research audit](https://github.com/T92T1914/tornado-atlas/blob/main/research/robinson-registration-decision-2026-10-04.md). That repository helped locate the original endpoint; the imported positions came directly from the original survey server.

Tim Samaras/TWISTEX's final approach is documented. [Wurman et al. (2014), *The Role of Multiple-Vortex Tornado Structure in Causing Storm Researcher Fatalities*](https://doi.org/10.1175/BAMS-D-13-00221.1), reconstruct the vehicle traveling east on Reuter Road around **6:21–6:22 PM CDT** (23:21–23:22 UTC), with its headlights last visible west of Radio Road at **6:22:15 PM CDT** (23:22:15 UTC). These are video-supported sightings and a reconstruction, not precise GPS fixes or a continuous measured trajectory. The paper distinguishes the inferred impact location from where the vehicle was recovered; neither should be displayed as its position throughout the chase.

[Skip Talbot's July 4, 2013 creator post](https://stormtrack.org/threads/2013-05-31-event-ks-ok-mo-il.26811/page-14/) also describes a reconstruction using contributed GPS logs, timestamped photographs, accounts of the team's locations, and annotated maps. That publication does not establish a downloadable TWISTEX GPS track.

No verified public timestamped TWISTEX trajectory was recovered in this bounded search, and none is present among the 33 imported survey tracks. The map therefore supplies no animated Tim Samaras/TWISTEX route. A documented reconstruction could be added with explicit provenance and uncertainty, while keeping last sightings, inferred impact, and recovery locations separate. His absence from the map does not mean his whereabouts are entirely undocumented.

## Original video publications

Six original YouTube publications are registered in `videos.json`: Dan Robinson, Skip Talbot, Nick Nolte, Brandon Sullivan/Brett Wright, Chris Kridler and Pecos Hank. All six returned creator/title metadata from YouTube's public oEmbed endpoint on the checked date. This verifies the publication and the supported player URL, not complete playback in every location or a review of the full footage/audio.

The NWS service assessment links [Robinson's original dashcam publication](https://www.youtube.com/watch?v=MxgU1QcFMJM): <https://repository.library.noaa.gov/view/noaa/6975/noaa_6975_DS1.pdf>. [Nick Nolte's firsthand report](https://nnwx.us/blog/2013/07/15/may-31-2013-the-el-reno-ef-5/) supplies the Talbot, Sullivan/Wright and Nolte publication links. [Chris Kridler's firsthand report](https://www.chriskridler.com/2013/05/31-may-2013-tornado-at-el-reno-oklahoma/) directly embeds her publication. [Pecos Hank's original publication](https://www.youtube.com/watch?v=Q7X3fyId2U0) is verified by its own provider metadata.

No third-party video files or thumbnails were copied. The map links/embeds the creators' YouTube players. These external videos have null `time`, `lat` and `lon` and `timingStatus: "unlocated"`; the separately supplied local chase clips have their own timing manifest. An association with a survey contributor is a research lead, not a synchronized frame-to-position relationship. The unavailable legacy Vimeo player URLs have been removed from the interface and playback data. A bounded recovery search found no verified replacement synchronized archive; see [survey video availability](survey-video-availability.md). A similarly named YouTube edit must not inherit the old archive's timing automatically. Source JSON links remain in **About & sources**. Historical EF5 language in some source titles does not change the final NWS EF3 damage rating.

## Ben Holcomb identity and archival YouTube link

Checked November 4, 2026: the primary [El Reno Survey participant list](https://el-reno-survey.net/participants/), entry 41, identifies **Holcomb, Ben** and links his [May 31, 2013 report](https://www.benholcomb.com/chases/20130531/) plus two YouTube publications. This supports expanding the existing `Holcomb` label to `Ben Holcomb`; all source observations remain unchanged.

The survey's [original El Reno YouTube link](https://www.youtube.com/watch?v=eSV-PCUeBqM) is retained as a seventh, archival video reference. YouTube's publicly served watch-page player response states `LOGIN_REQUIRED` with the reason `Private video`; oEmbed returns HTTP 403. It is explicitly labeled private, not counted among the six oEmbed-verified public links above, and has no embed URL or assigned video/map timing. His public creator channel is [Oklahoma Storm Chaser](https://www.youtube.com/@Oklahomachaser), linked by his own website and identifying Ben Holcomb in its description.

The participant list's second [YouTube link](https://www.youtube.com/watch?v=RCnYOV1XhJY) is titled “Oklahoma Tornado May 31, 2013 near Tuttle, OK” in the creator's own channel metadata. It is a different tornado later that day and is not substituted as footage of El Reno. The previously bundled survey Vimeo URL returned HTTP 404 from Vimeo's oEmbed endpoint; no continuing playback availability is claimed for it.

## Adding a genuine historical export

Preserve the original file, retrieval date, source URL/account export context, hash, field definitions and timezone. Match `smotley`/public ID `5867` to the export's actual identity fields and compare overlapping observations against `GPS.json`; do not infer a person from proximity alone. Retain conflicting fixes and gaps for review. Keep public ID separate from any secret application credentials.

Each imported track uses `id`, `name`, `username`, `kind`, `sourceUrl`, `points: [{time, lat, lon}]` and `videos`. `kind: "survey-camera"` identifies the current archive; use a separately documented kind for actual Spotter Network transmissions. For TWISTEX, require documentary evidence of the track identity before styling its marker as the white car. Interpolation stops at the last supported sample and across long gaps or flagged intervals.
