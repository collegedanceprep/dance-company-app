// PrepMaster headshots in public/team/<name-slug>.jpg (resized from the website's headshots).
// To add a photo: drop <first-last>.jpg into public/team and add the slug here.
const TEAM_PHOTO_SLUGS = new Set<string>([
  "aaliyah-plotts",
  "arhysa-gamboa",
  "audrey-sams",
  "avery-clevlen",
  "bella-flath",
  "brittany-reynolds",
  "brookelyn-norris",
  "brooklyn-bratetic",
  "cadence-lyrock",
  "campbell-yung",
  "cary-casler",
  "cecilia-coleman",
  "drew-russell",
  "eliza-krogh",
  "ella-reeves",
  "ellery-corcoran",
  "ellie-chain",
  "emily-taylor",
  "emma-chase",
  "emma-rutherford",
  "gracie-smith",
  "janae-feimster",
  "jayden-diaz",
  "jillian-maniscalchi",
  "kara-manuud",
  "kara-vecchio",
  "kasey-hub",
  "katelyn-kilgore",
  "lexi-garbiero",
  "lilly-green",
  "lily-villasenor",
  "logan-carl",
  "london-richard-edwards",
  "lucia-delgreco",
  "mackenna-riggs",
  "madison-mclain",
  "manhattan-tibbott",
  "morgan-mcmonigle",
  "natalie-winzenread",
  "olivia-philson",
  "olyvia-clark",
  "paloma-alvarez",
  "raelynn-espinoza",
  "renee-yang",
  "riley-macarthur",
  "riley-matthews",
  "sadie-perkins",
  "samantha-maya",
  "sara-kenney",
  "shea-o-malley",
  "sophia-macinnis",
  "sophia-torres",
  "summer-davis",
  "sydney-jordan",
  "tatum-kempf",
  "taya-mishin",
  "taygen-brown",
  "taylor-javoroski",
  "tessa-anderson",
]);

export function teamPhotoSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

/** Site-relative photo path for a PrepMaster, or null when we don't have one. */
export function teamPhotoUrl(name: string | undefined | null): string | null {
  if (!name) return null
  const slug = teamPhotoSlug(name)
  return TEAM_PHOTO_SLUGS.has(slug) ? `/team/${slug}.jpg` : null
}
