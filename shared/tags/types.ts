/**
 * A tag the project has been told about: a colour, and a place in the order.
 *
 * The registry is advisory. A tag on an object that no entry names is still a
 * tag — it just draws in the unknown colour and offers no completion. Nothing
 * downstream may treat an unregistered name as absent or invalid.
 */
export interface TagDefinition {
  name: string

  color: string
}

/** Ordered: earlier entries win when an object carries several known tags. */
export type TagRegistry = readonly TagDefinition[]
