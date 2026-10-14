(() => {
  "use strict";
  // Enhancement only. Auth, friends, messages, rankings and catalog links stay owned by existing hub modules.
  const input = document.getElementById("editorial-game-search");
  const host = document.getElementById("game-cards");
  const empty = document.getElementById("editorial-arcade-empty");
  const buttons = [...document.querySelectorAll("[data-arcade-filter]")];
  if (!input || !host || !empty || !buttons.length) return;
  let filter = "all";
  const matchesCategory = (id) => filter === "all" || (filter === "simulation" ? id === "induck-grow" : id !== "induck-grow");
  function update() {
    const term = input.value.trim().toLocaleLowerCase("ko-KR");
    let visible = 0;
    for (const card of host.querySelectorAll(".game-card[data-game-id]")) {
      const id = card.dataset.gameId || "";
      const title = card.querySelector("h3")?.textContent || "";
      const description = card.querySelector("p")?.textContent || "";
      const show = matchesCategory(id) && (!term || (title + " " + description).toLocaleLowerCase("ko-KR").includes(term));
      card.hidden = !show;
      if (show) visible++;
    }
    empty.hidden = visible > 0;
    buttons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.arcadeFilter === filter)));
  }
  buttons.forEach(button => button.addEventListener("click", () => {
    filter = button.dataset.arcadeFilter || "all";
    update();
  }));
  input.addEventListener("input", update);
  new MutationObserver(update).observe(host, {childList:true});
  update();
})();
