import { startPillbugTour, tourStepsFromDefs, type TourStepDef } from "../shared/tour";

const STEP_DEFS: TourStepDef[] = [
  {
    element: "[data-tour='config-tour-help']",
    title: "Config",
    description:
      "The Config tab is where you, of course, configure your settings. You can log in, manage saved projects, install nodepacks, and decide what pages you will edit.",
    side: "bottom",
  },
  {
    element: "[data-tour='config-wiki-origin']",
    title: "Wiki origin",
    description:
      "Set the MediaWiki site you want to edit (for example https://en.wikipedia.org) before logging in.",
    side: "left",
  },
  {
    element: "[data-tour='config-login']",
    title: "Login",
    description:
      "If OAuth is available, use it to log in. Otherwise, log in with a BotPassword from Special:BotPasswords. Your bot password will not be saved.",
    side: "left",
  },
  {
    element: "[data-tour='config-projects']",
    title: "Projects list",
    description:
      "A project is a snapshot of your current workspace, which can be used for version control, or sharing your work with others. Load a project from the list, or import / export / delete projects.",
    side: "left",
  },
  {
    element: "[data-tour='config-project-bar']",
    title: "Project bar",
    description:
      "Here you can name the current project, and save, save copy (see next step), or load a project. If the project name is changed, save copy will be replaced with the load project button.",
    side: "top",
  },
  {
    element: "[data-tour='config-save-copy-mode']",
    title: "Save copy mode",
    description:
      "The behavior of save copy can be configured here. The default is appending a timestamp to the project name, however you can also choose to increment the number at the end of the project name, or append 'copy' to the project name.",
    side: "left",
  },
  {
    element: "[data-tour='config-generator']",
    title: "Generator",
    description:
      "The generator can make a list of pages to work on. By configuring the generator, you can choose how to find pages. For example, you can search for pages by title, or get all pages in a category.",
    side: "right",
  },
  {
    element: "[data-tour='config-page-queue']",
    title: "Page queue",
    description:
      "The page queue is the list of pages that Code will process and Review will show. You can edit the queue after generating it, or type/paste in a list.",
    side: "left",
  },
  {
    element: "[data-tour='config-nodepacks']",
    title: "Nodepacks",
    description:
      "Experimental: nodepacks are bundles of nodes that can be installed and uninstalled, for use in the Code tab.",
    side: "left",
  },
];

export function startConfigTour(): void {
  startPillbugTour(tourStepsFromDefs(STEP_DEFS));
}
