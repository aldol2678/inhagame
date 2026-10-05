import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Enforce environment variable credential check as per security governance
const apiKey = process.env.VWORLD_API_KEY;
if (!apiKey) {
  console.error('ERROR: VWORLD_API_KEY environment variable is required.');
  console.error('Usage: VWORLD_API_KEY=<your_key> node enrich-gis-candidates.mjs');
  process.exit(1);
}

// Relative path resolution via import.meta.url (portable across environments)
const dataFilePath = fileURLToPath(new URL('./gis-candidates.json', import.meta.url));

if (!fs.existsSync(dataFilePath)) {
  console.error(`ERROR: Data file not found at: ${dataFilePath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));

/**
 * Query Seumter building ledger metadata for a coordinate location.
 * @param {number} lon Longitude (WGS84)
 * @param {number} lat Latitude (WGS84)
 * @param {string} key VWorld API Key
 */
async function queryMeta(lon, lat, key) {
  // Support authenticated endpoint query using VWORLD_API_KEY
  const url = `https://map.vworld.kr/dtkmap/po_buildMetaInfoGIS.do?TYPENAME=LT_C_BLDGBASE&SRSNAME=EPSG:4326&BLDGPOS=POINT(${lon} ${lat})&MAPMODE=3D&SERVICE=WFS&REQUEST=GetFeature&VERSION=1.1.0&key=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, {
      headers: { 'Referer': 'https://map.vworld.kr/map/maps.do' }
    });
    const html = await res.text();
    if (!html || html.includes('제공하지')) return null;

    const parseField = (label) => {
      const regex = new RegExp(`<th>${label}<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i");
      const m = html.match(regex);
      return m ? m[1].replace(/<[^>]+>/g, "").trim() : null;
    };
    const titleM = html.match(/<p class="tit">([^<]+)<\/p>/);
    const roadM = html.match(/<p class="adr">([^<]+)<\/p>/);
    const jibunM = html.match(/<p class="adr old">([^<]+)<\/p>/);
    const pnuM = html.match(/id="pnu"\s+value="([^"]+)"/);

    return {
      title: titleM ? titleM[1].trim() : null,
      roadAddr: roadM ? roadM[1].trim() : null,
      jibunAddr: jibunM ? jibunM[1].trim() : null,
      pnu: pnuM ? pnuM[1].trim() : null,
      dongName: parseField("건물동명칭"),
      purpose: parseField("건물용도"),
      structure: parseField("구조"),
      groundFloors: parseField("지상층수"),
      undergroundFloors: parseField("지하층수"),
      bldgArea: parseField("건물면적"),
      totalArea: parseField("연면적"),
      approvalDate: parseField("사용승인일자")
    };
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log(`Enriching ${data.features.length} GIS features using VWorld API Key...`);
  for (let i = 0; i < data.features.length; i++) {
    const f = data.features[i];
    const [cLat, cLon] = f.centroid;
    const meta = await queryMeta(cLon, cLat, apiKey);
    if (meta) {
      f.regTitle = meta.title;
      f.regRoadAddr = meta.roadAddr;
      f.regJibunAddr = meta.jibunAddr;
      f.regPnu = meta.pnu;
      f.regDong = meta.dongName;
      f.regPurpose = meta.purpose;
      f.regStructure = meta.structure;
      f.regGroundFloors = meta.groundFloors;
      f.regUndergroundFloors = meta.undergroundFloors;
      f.regBldgArea = meta.bldgArea;
      f.regTotalArea = meta.totalArea;
      f.regApprovalDate = meta.approvalDate;
    }
  }

  fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
  console.log(`Successfully saved enriched dataset to ${dataFilePath}\n`);
}

main().catch(console.error);
