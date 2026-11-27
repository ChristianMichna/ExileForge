// usage: node tools/fetch-price-book.mjs <server-url> <token-file> <item-map.json>
// Asks a running server (started with --economy <cache-dir>) for one market price, which makes it
// fetch and store the price book of the current league from the provider. The cache directory is
// then the result. Nothing is priced or estimated here; a failed fetch fails the script.
import { readFileSync } from "node:fs";
import { Client } from "../apps/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StreamableHTTPClientTransport } from "../apps/server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js";

const [url, tokenFile, itemMapFile] = process.argv.slice(2);
if (!url || !tokenFile || !itemMapFile)
  throw new Error("usage: fetch-price-book.mjs <server-url> <token-file> <item-map.json>");
const token = readFileSync(tokenFile, "utf8").trim();
const itemMap = JSON.parse(readFileSync(itemMapFile, "utf8"));
const first = Object.values(itemMap.items)[0];
if (!first) throw new Error("the item map has no items");

const client = new Client({ name: "price-book-fetch", version: "0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
);
const result = await client.callTool({ name: "economy_price", arguments: { items: [first] } });
await client.close();
const text = result.content.map((c) => c.text).join("\n");
if (result.isError) throw new Error(`economy_price failed: ${text}`);
const out = JSON.parse(text);
console.log(`league ${out.league}, freshness ${JSON.stringify(out.freshness)}`);
if (out.freshness !== "fresh") {
  // a stale book would be an old one: the point of this run is a fresh one
  throw new Error(`the book is not fresh (${out.freshness}); nothing is published`);
}
