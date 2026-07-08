import { computed, ref, watch } from "vue";

export type AppTab = "config" | "code" | "review";

export const TABS: { id: AppTab; label: string }[] = [
  { id: "config", label: "Config" },
  { id: "code", label: "Code" },
  { id: "review", label: "Review" },
];

export const activeTab = ref<AppTab>("config");
export const sidebarCollapsed = ref(false);

export const canCollapseSidebar = computed(() => activeTab.value !== "review");

watch(activeTab, (tab) => {
  if (tab === "review") {
    sidebarCollapsed.value = false;
  }
});

export function setActiveTab(tab: AppTab): void {
  activeTab.value = tab;
}

export function toggleSidebar(): void {
  if (!canCollapseSidebar.value) return;
  sidebarCollapsed.value = !sidebarCollapsed.value;
}
