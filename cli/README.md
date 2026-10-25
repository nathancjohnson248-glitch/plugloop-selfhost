# plugloop

Self-host [Plugloop](https://github.com/nathancjohnson248-glitch/plugloop-selfhost), revenue-first web analytics, on your own Cloudflare account in about 2 minutes.

```bash
npx plugloop@latest
```

It will:

1. download the latest Plugloop release into `./plugloop`
2. install its dependencies (Wrangler)
3. run `wrangler login` (a browser window opens; click **Allow**)
4. create the D1 database and write its id into `wrangler.jsonc`
5. apply the database migrations
6. ask for a dashboard password and upload it as the `ADMIN_PASSWORD` secret
7. deploy the Worker and print your dashboard URL

## Update

```bash
npx plugloop@latest update
```

Run it in your Plugloop folder (or its parent). It pulls the latest release, keeps your database, Worker name, `vars` and account, applies any new migrations and redeploys. Your password and other secrets stay as they are.

## Options

| | |
| --- | --- |
| `--dir <path>` | project folder (default `./plugloop`) |
| `--name <name>` | Worker and D1 database name, install only (default `plugloop`) |
| `--ref <tag>` | use a specific release tag or branch |
| `--force` | `update`: redeploy even if already on the latest release |

Set `PLUGLOOP_ADMIN_PASSWORD` to skip the password prompt, and `CLOUDFLARE_ACCOUNT_ID` to pick an account without being asked.

Needs Node.js 18+ and a free Cloudflare account. Nothing runs anywhere except your own Cloudflare account.
