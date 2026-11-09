Leads Automate requests access to `https://www.linkedin.com/sales/*` to run on the Sales Navigator search the user has open: read the search results, set the company filter and open leads, and to read the search filters from the tab's address. `https://www.linkedin.com/sales-api/*` is used only to notice LinkedIn's "Too many requests" limit, so the extension stops in time.

`https://www.linkedin.com/company/*`, `/showcase/*` and `/school/*` let it read a company's id from its public LinkedIn page, when the user's company list gives the company's page link instead of its id.

`https://media.licdn.com/*` lets it load the company logos shown in Sales Navigator's suggestions, to compare them with the logos in the user's company list and confirm the right company is chosen.

It does not run on, or access, any other site.
