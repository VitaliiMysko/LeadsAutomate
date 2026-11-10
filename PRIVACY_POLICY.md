# Privacy Policy for Leads Automate Extension

**Effective Date**: November 9, 2026
**Last Updated**: November 10, 2026

This privacy policy explains what information the **Leads Automate** extension handles and how.

## 1. Where the extension works

Leads Automate works only on LinkedIn Sales Navigator (`https://www.linkedin.com/sales/*`), in a side panel the user opens. It does not run on any other website.

## 2. Information the extension reads

Only while the user runs a search or an export from the panel, the extension reads from the Sales Navigator page the user has open:

- the search's filters, from the page address;
- the people in the search results: name, job title, company, location and time in role, to pick the people whose job titles match the user's priorities;
- the companies in a company search's results: their LinkedIn company id and name, for the companies export;
- the company suggestions shown while it sets the company filter, with their logos.

When the user's company list gives a company's LinkedIn page link instead of its id, the extension reads the company's id and name from that public LinkedIn page.

The extension does not collect anything in the background, does not track browsing, and reads no other sites.

## 3. Companion extension (Lead Generator)

Picked leads are opened on the page and handed to the separately installed **Lead Generator** extension by the same developer, which extracts the lead's details, generates an email and saves the lead (see [Lead Generator's own privacy policy](https://vitaliimysko.github.io/LeadGenerator/PRIVACY_POLICY.html)). Lead Generator returns the outcome to Leads Automate: the person's name, job position, company name and website, the generated email and whether the lead was saved. This exchange happens entirely inside the user's browser, between the two extensions.

## 4. Information stored on the user's device

The extension uses the browser's local extension storage to keep, on the user's device only:

- the job-title board, settings and limits;
- the company list the user loaded, its progress and the companies waiting for a manual choice;
- fingerprints and small thumbnails of the company logos the user selected;
- the ids and names of companies read from their public LinkedIn pages;
- statistics (counts of pages, leads processed and found);
- an unfinished companies export (company ids and names);
- when the user turns on "Record leads' job titles": job titles and how many leads had each, without names or other personal details.

Details of individual people (names, emails) are not stored by Leads Automate. They are shown only in the panel's log while the panel is open.

Files the user downloads (CSV exports, the saved job-title board) are saved where the user chooses.

## 5. No data sharing

Leads Automate has no server of its own. It does not send any data to the developer or to third parties, does not sell or share data, and does not use analytics or tracking.

Its only network requests go to LinkedIn: the Sales Navigator pages the user is working on, public LinkedIn company pages and LinkedIn's logo images. Public company pages are loaded without the user's LinkedIn session, except LinkedIn school pages, which LinkedIn shows only to signed-in members.

## 6. User control

- Searches and exports run only when the user starts them, and can be stopped at any time.
- The user can reset statistics, clear the company list and lists in the panel at any time.
- Removing the extension deletes all the data it stored.

## 7. Changes to this policy

Changes to this policy are published with a new "Last Updated" date.

## 8. Contact

For questions about this privacy policy or the extension's data practices, contact the developer at [vitalij.musko@gmail.com](mailto:vitalij.musko@gmail.com).
