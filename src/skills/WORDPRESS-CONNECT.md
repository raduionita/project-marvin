# Connect a Wordpress site

Set up an integration to post articles to a Wordpress site (e.g. gloobeam.com) through its REST API.

## Steps

1. Run `marvin integrations add <name> wordpress` (e.g. `marvin integrations add gloobeam wordpress`).
2. Enter the site URL (e.g. gloobeam.com). Marvin will discover the available actions and fields by calling the Wordpress REST API (OPTIONS on `https://site/wp-json/wp/v2/<resource>`).
3. Enter the credentials (username and application password). Wordpress application passwords are created in the site's admin (Users -> Profile -> Application Passwords).
4. Pick which actions to expose (e.g. create_post, publish_post) and which fields each action needs. Standard Wordpress fields (title, content, excerpt, status, categories, tags, featured_media) come pre-filled; mark the ones that must be sent.
5. Add any site-specific custom fields as `meta` fields (e.g. ACF fields on gloobeam.com) when the site needs them.

## Rules

- Wordpress is a fixed REST API, so discovery normally finds the real fields automatically.
- Custom fields that are not exposed through the REST API must be added manually as meta fields in the wizard (or later via `marvin integrations edit <name>`).
- When writing an article, first call `find_integration` with the integration id and action (e.g. create_post) to learn which fields are required, then call `call_integration` with those fields.
- Credentials live in marvin.json; application passwords are preferred over account passwords.
