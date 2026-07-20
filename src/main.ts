import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import TextBoardApp from "./TextBoardApp.vue";
import "./index.css";
import { windowRole } from "./lib/windowRole";

createApp(windowRole === "text-board" ? TextBoardApp : App)
  .use(createPinia())
  .mount("#app");
