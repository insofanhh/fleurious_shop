"use client";
import { useState } from "react";
import { catalogueSlug } from "@/lib/catalogue";
export function useAutoSlug(
  initialName = "",
  initialSlug = "",
  editing = false,
) {
  const [name, setName] = useState(initialName),
    [slug, setSlug] = useState(initialSlug);
  const [manual, setManual] = useState(editing);
  return {
    name,
    slug,
    changeName(value: string) {
      setName(value);
      if (!manual) setSlug(catalogueSlug(value));
    },
    changeSlug(value: string) {
      setSlug(value);
      setManual(!!value);
    },
    resetSlug() {
      setManual(false);
      setSlug(catalogueSlug(name));
    },
  };
}
