import { mkdir, writeFile } from "node:fs/promises";
import * as icons from "simple-icons/icons";

const outputDir = new URL("../public/logos/", import.meta.url);

const providers = [
  ["godaddy", icons.siGodaddy],
  ["hostinger", icons.siHostinger],
  ["namecheap", icons.siNamecheap],
  ["cloudflare", icons.siCloudflare],
  ["ionos", icons.siIonos],
  ["wix", icons.siWix],
  ["squarespace", icons.siSquarespace],
  ["wordpress", icons.siWordpress],
  ["cpanel", icons.siCpanel],
  ["kinsta", icons.siKinsta],
  ["digitalocean", icons.siDigitalocean],
  ["aws", icons.siAmazonwebservices],
  ["shopify", icons.siShopify],
  ["webflow", icons.siWebflow],
  ["vercel", icons.siVercel],
  ["netlify", icons.siNetlify],
  ["render", icons.siRender],
  ["firebase", icons.siFirebase],
];

const remoteProviders = [
  [
    "siteground",
    "https://www.siteground.com/img/downloads/siteground-logo-black-transparent-vector.svg",
  ],
  ["hostgator", "https://www.vectorlogo.zone/logos/hostgator/hostgator-icon.svg"],
  ["bluehost", "https://www.svgrepo.com/download/331324/bluehost.svg"],
];

await mkdir(outputDir, { recursive: true });

for (const [slug, icon] of providers) {
  if (!icon) {
    console.warn(`Icono no encontrado: ${slug}`);
    continue;
  }

  const svg = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>${icon.title}</title><path fill="#${icon.hex}" d="${icon.path}"/></svg>\n`;
  await writeFile(new URL(`${slug}.svg`, outputDir), svg, "utf8");
  console.log(`Descargado ${slug}.svg`);
}

for (const [slug, url] of remoteProviders) {
  const response = await fetch(url);

  if (!response.ok) {
    console.warn(`No se pudo descargar ${slug}.svg (${response.status})`);
    continue;
  }

  await writeFile(new URL(`${slug}.svg`, outputDir), await response.text(), "utf8");
  console.log(`Descargado ${slug}.svg`);
}
