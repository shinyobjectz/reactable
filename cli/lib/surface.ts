import { apiBase, PORT } from "./paths.ts";

// A Surface is the atom the Stage can show. Mirrors the nexus data model
// (present/api.work surfaces_for/*). kind ∈ deck | take | doc | web |
// hyperframes | youtube | artifact | research.
export type SurfaceKind =
  | "deck"
  | "take"
  | "doc"
  | "web"
  | "hyperframes"
  | "youtube"
  | "artifact"
  | "research";

export interface Surface {
  kind: SurfaceKind;
  id: string; // "deck:showcase", "take:take-…", "doc:notes.md", …
  title: string;
  ref: string; // slug / path / url
  project: string;
}

export interface ProjectAggregate {
  ok: boolean;
  id: string;
  name: string;
  path: string;
  research: { id: string; path: string }[];
  decks: Surface[];
  takes: Surface[];
  surfaces: Surface[];
}

export async function getProject(id?: string, port = PORT): Promise<ProjectAggregate> {
  const q = id ? `?id=${encodeURIComponent(id)}` : "";
  const res = await fetch(`${apiBase(port)}/reactable/project${q}`);
  return res.json();
}

/** All surfaces; pass a project id to scope, omit for every project (⌘I palette). */
export async function listSurfaces(project?: string, port = PORT): Promise<Surface[]> {
  const q = project ? `?project=${encodeURIComponent(project)}` : "";
  const res = await fetch(`${apiBase(port)}/reactable/surfaces${q}`);
  const data = await res.json();
  return data.surfaces ?? [];
}

export async function listResearch(project?: string, port = PORT): Promise<{ id: string; title: string }[]> {
  const q = project ? `?project=${encodeURIComponent(project)}` : "";
  const res = await fetch(`${apiBase(port)}/reactable/research${q}`);
  const data = await res.json();
  return data.research ?? [];
}

export async function addResearch(
  title: string,
  opts: { url?: string; note?: string; project?: string } = {},
  port = PORT,
) {
  const res = await fetch(`${apiBase(port)}/reactable/research/add`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, url: opts.url ?? "", note: opts.note ?? "", project: opts.project ?? "" }),
  });
  return res.json();
}
