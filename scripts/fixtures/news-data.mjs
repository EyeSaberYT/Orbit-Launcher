// Isolated GitHub-shaped news fixtures. Never imported by production code.
export const representativeNews = [
  { name:'Orbit Launcher v0.5.11', tag_name:'v0.5.11', published_at:'2026-11-06T13:26:35Z' },
  { name:'Orbit Launcher v0.5.10', tag_name:'v0.5.10', published_at:'2026-11-05T16:14:56Z' },
  { name:'Orbit Launcher v0.5.9', tag_name:'v0.5.9', published_at:'2026-11-04T21:08:16Z' },
].map(post => ({ ...post, draft:false, prerelease:false, assets:[],
  html_url:`https://github.com/EyeSaberYT/Orbit-Launcher/releases/tag/${post.tag_name}`,
  body:'Release notes and downloads for this Orbit Launcher version.',
}));
console.assert(representativeNews.length===3,'Three representative news posts');
console.assert(representativeNews.every((post,i,rows)=>!i||Date.parse(rows[i-1].published_at)>Date.parse(post.published_at)),'News fixtures newest first');
