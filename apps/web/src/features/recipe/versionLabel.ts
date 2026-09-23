/*
  "V1" is what the database calls a version (0007's `tag`). It is a fine key
  and a poor caption: an English letter in a Hebrew timeline, and one a baker
  has no reason to recognise (QA 22.09.2026, acceptance finding 33). The tag
  itself is untouched — it is compared, restored and stored as it always was.
  Only what the screen prints changes.
*/
export function versionLabel(tag: string): string {
  const m = /^V(\d+)$/i.exec(String(tag ?? '').trim());
  return m ? `גרסה ${m[1]}` : `גרסה ${tag}`;
}
