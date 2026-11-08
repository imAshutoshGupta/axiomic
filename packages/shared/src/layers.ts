/**
 * Rule layers, from widest to narrowest.
 * On the same topic, a narrower layer replaces a wider one, except:
 * - locked company/team rules can't be replaced by anything
 * - personal rules only add new topics and never replace a work rule
 */
export const LAYERS = ["company", "team", "project", "module", "personal"] as const;

export type Layer = (typeof LAYERS)[number];
