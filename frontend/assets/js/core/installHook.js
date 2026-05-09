if (typeof InstallHook === "undefined") {
  const InstallHook = {
    libraries: {
      fullcalendar: false,
      utils: false,
    },

    async init() {
      this.checkLibraries();
      this.addCalendarStyles();
    },

    checkLibraries() {
      if (typeof FullCalendar !== "undefined") {
        this.libraries.fullcalendar = true;
      }

      if (typeof Utils !== "undefined") {
        this.libraries.utils = true;
      }
    },

    addCalendarStyles() {
      const style = document.createElement("style");
      style.textContent = `

        .fc-event,
        .fc-daygrid-event,
        .fc-timegrid-event,
        .fc-list-event {
          user-select: none !important;
          -webkit-user-select: none !important;
          -moz-user-select: none !important;
          -ms-user-select: none !important;
        }

        .fc-event::selection,
        .fc-daygrid-event::selection,
        .fc-timegrid-event::selection {
          background: transparent !important;
        }

        .fc-event {
          cursor: pointer !important;
          -webkit-user-drag: none !important;
        }
      `;
      document.head.appendChild(style);
    },

    async waitForLibrary(name, timeout = 5000) {
      const startTime = Date.now();

      while (!this.libraries[name]) {
        if (Date.now() - startTime > timeout) {
          throw new Error(`${name} failed to load within ${timeout}ms`);
        }

        this.checkLibraries();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => InstallHook.init());
  } else {
    InstallHook.init();
  }

  window.InstallHook = InstallHook;
}
