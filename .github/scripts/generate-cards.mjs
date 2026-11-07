import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = process.argv[2] ?? "dist";
const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_USER;

if (!token || !login) {
  throw new Error("GITHUB_TOKEN e GITHUB_USER são obrigatórios.");
}

const query = `
query ($login: String!) {
  user(login: $login) {
    pullRequests { totalCount }
    issues { totalCount }
    contributionsCollection {
      totalCommitContributions
      contributionCalendar { totalContributions }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "profile-cards-generator",
  },
  body: JSON.stringify({ query, variables: { login } }),
});

const payload = await response.json();
if (!response.ok || payload.errors) {
  throw new Error(`Falha ao consultar a API do GitHub: ${JSON.stringify(payload.errors ?? payload)}`);
}

const user = payload.data.user;
const repositories = user.repositories.nodes;

const stats = {
  stars: repositories.reduce((total, repository) => total + repository.stargazerCount, 0),
  commits: user.contributionsCollection.totalCommitContributions,
  pullRequests: user.pullRequests.totalCount,
  issues: user.issues.totalCount,
  repositories: user.repositories.totalCount,
  contributions: user.contributionsCollection.contributionCalendar.totalContributions,
};

const languageTotals = new Map();
for (const repository of repositories) {
  for (const { size, node } of repository.languages.edges) {
    const current = languageTotals.get(node.name) ?? { size: 0, color: node.color };
    current.size += size;
    languageTotals.set(node.name, current);
  }
}

const totalLanguageSize = [...languageTotals.values()].reduce((total, language) => total + language.size, 0);
const topLanguages = [...languageTotals.entries()]
  .map(([name, { size, color }]) => ({ name, color: color ?? "#D4AF37", percent: totalLanguageSize ? (size / totalLanguageSize) * 100 : 0 }))
  .sort((a, b) => b.percent - a.percent)
  .slice(0, 6);

const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);

const formatNumber = (value) => new Intl.NumberFormat("pt-BR").format(value);

const cardFrame = (title, content) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 495 200" width="495" height="200" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#241910"/>
      <stop offset="1" stop-color="#120c07"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="493" height="198" rx="14" fill="url(#bg)" stroke="#D4AF37" stroke-width="2"/>
  <rect x="8" y="8" width="479" height="184" rx="10" fill="none" stroke="#D4AF37" stroke-opacity="0.25" stroke-dasharray="4 4"/>
  <text x="25" y="38" font-family="Georgia, 'Times New Roman', serif" font-size="18" font-weight="bold" letter-spacing="2" fill="#D4AF37">${escapeXml(title)}</text>
  <line x1="25" y1="48" x2="470" y2="48" stroke="#D4AF37" stroke-opacity="0.4"/>
  ${content}
</svg>
`;

const statRows = [
  ["Estrelas conquistadas", stats.stars],
  ["Commits no último ano", stats.commits],
  ["Pull requests enviados", stats.pullRequests],
  ["Issues abertas", stats.issues],
  ["Repositórios públicos", stats.repositories],
];

const statsContent = `
  <g font-family="Georgia, 'Times New Roman', serif" font-size="15">
    ${statRows
      .map(
        ([label, value], index) => `<g opacity="0">
      <animate attributeName="opacity" from="0" to="1" begin="${(0.15 * index).toFixed(2)}s" dur="0.5s" fill="freeze"/>
      <polygon points="30,${72 + index * 26} 35,${67 + index * 26} 40,${72 + index * 26} 35,${77 + index * 26}" fill="#C0392B"/>
      <text x="50" y="${77 + index * 26}" fill="#F5E6C8">${escapeXml(label)}</text>
      <text x="300" y="${77 + index * 26}" text-anchor="end" font-weight="bold" fill="#D4AF37">${formatNumber(value)}</text>
    </g>`,
      )
      .join("\n    ")}
  </g>
  <g transform="translate(395 118)">
    <circle r="58" fill="#D4AF37" opacity="0.12">
      <animate attributeName="r" values="52;60;52" dur="3s" repeatCount="indefinite"/>
    </circle>
    <path d="M0 -52 L48 -38 V2 Q48 38 0 60 Q-48 38 -48 2 V-38 Z" fill="#8B0000" stroke="#D4AF37" stroke-width="3"/>
    <text y="4" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${stats.contributions >= 10000 ? 18 : 22}" font-weight="bold" fill="#FFF6CC">${formatNumber(stats.contributions)}</text>
    <text y="24" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="8.5" letter-spacing="0.5" fill="#D4AF37">CONTRIBUIÇÕES</text>
    <text y="36" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="8.5" letter-spacing="0.5" fill="#D4AF37">NO ANO</text>
  </g>`;

const barMaxWidth = 250;
const languagesContent = `
  <g font-family="Georgia, 'Times New Roman', serif" font-size="14">
    ${topLanguages
      .map((language, index) => {
        const y = 70 + index * 22;
        const width = Math.max((language.percent / 100) * barMaxWidth, 4).toFixed(1);
        const begin = (0.15 * index).toFixed(2);
        return `<g>
      <circle cx="32" cy="${y}" r="5" fill="${escapeXml(language.color)}"/>
      <text x="44" y="${y + 5}" fill="#F5E6C8">${escapeXml(language.name)}</text>
      <rect x="165" y="${y - 6}" width="${barMaxWidth}" height="12" rx="6" fill="#2a1d12" stroke="#6b4a1e"/>
      <rect x="165" y="${y - 6}" width="0" height="12" rx="6" fill="${escapeXml(language.color)}">
        <animate attributeName="width" from="0" to="${width}" begin="${begin}s" dur="1.2s" fill="freeze"/>
      </rect>
      <text x="470" y="${y + 5}" text-anchor="end" font-weight="bold" fill="#D4AF37">${language.percent.toFixed(1).replace(".", ",")}%</text>
    </g>`;
      })
      .join("\n    ")}
  </g>`;

await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, "stats.svg"), cardFrame("ESTATÍSTICAS DO CAVALEIRO", statsContent));
await writeFile(join(outputDir, "langs.svg"), cardFrame("LÍNGUAS DOMINADAS", languagesContent));

console.log("Cards gerados:", stats, topLanguages);
