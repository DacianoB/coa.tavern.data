import { databaseSections } from "@/lib/entities";

export function getDatabaseCategoryTree() {
  return databaseSections.map((section) => ({
    id: section.key,
    label: section.label,
    children: section.items.map((item) => ({
      id: item.href,
      label: item.label,
      href: item.href,
    })),
  }));
}
