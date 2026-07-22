import { ref } from "vue";

export type AppTab = "config" | "code" | "review";

export const TABS: { id: AppTab; label: string }[] = [
  { id: "config", label: "Config" },
  { id: "code", label: "Code" },
  { id: "review", label: "Review" },
];

export const activeTab = ref<AppTab>("config");
export const changelogOpen = ref(false);

export function setActiveTab(tab: AppTab): void {
  activeTab.value = tab;
}

export function openChangelog(): void {
  changelogOpen.value = true;
}

export function closeChangelog(): void {
  changelogOpen.value = false;
}

export function toggleChangelog(): void {
  changelogOpen.value = !changelogOpen.value;
}
