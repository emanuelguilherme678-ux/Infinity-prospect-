/*
 * Referências de sites e de interface, mostradas em Biblioteca de design.
 *
 * Para adicionar uma referência, copie um objeto de REFERENCIAS:
 *   tipo:      "site" (filtrado por nicho) ou "interface"
 *   nome:      nome do site ou da tela
 *   nicho:     um dos NICHOS (obrigatório em "site")
 *   url:       endereço do site de referência (abre em nova aba)
 *   img:       caminho da captura de tela, ex.: "img/refs/barbearia-01.webp" (opcional)
 *   descricao: o que é o site, em 1 a 2 frases
 *   observar:  lista curta do que copiar do design
 */

window.NICHOS = [
  "Barbearia", "Salão de beleza", "Estética / Spa", "Restaurante", "Pizzaria",
  "Lanchonete", "Hamburgueria", "Churrascaria", "Padaria", "Confeitaria", "Doceria",
  "Sorveteria", "Açaiteria", "Cafeteria", "Farmácia", "Dentista / Clínica odontológica",
  "Clínica médica", "Fisioterapia", "Psicólogo", "Nutricionista", "Academia",
  "Estúdio de pilates", "Personal trainer", "Mercado / Mercearia", "Hotel / Pousada",
  "Oficina mecânica", "Borracharia", "Posto de combustível", "Lava-rápido", "Advogado",
  "Contador / Escritório contábil", "Imobiliária", "Arquitetura / Design de interiores",
  "Pet shop", "Veterinária", "Loja de roupas", "Boutique", "Loja de calçados", "Ótica",
  "Joalheria", "Papelaria", "Floricultura", "Loja de móveis", "Marcenaria",
  "Material de construção", "Eletricista", "Assistência técnica", "Chaveiro",
  "Vidraçaria / Serralheria", "Lavanderia", "Agência de viagens", "Escola de idiomas",
  "Autoescola", "Buffet / Festas", "Fotógrafo", "Estúdio de tatuagem",
  "Transportadora / Mudanças", "Loja de conveniência", "Energia solar",
  "Segurança eletrônica", "Climatização / Ar-condicionado", "Consultoria empresarial",
  "Seguros / Corretora", "Construtora", "Móveis planejados", "Loja de celulares",
  "Agência de marketing", "Desenvolvimento de software"
];

// Ainda vazio: as referências entram aqui conforme as capturas e os links forem enviados.
window.REFERENCIAS = [];

(function () {
  var ligado = false;
  var gatilho = null;

  function $(id) { return document.getElementById(id); }

  function filtrar() {
    var tipo = $("refsTipo").value;
    var nicho = $("refsNicho").value;
    return window.REFERENCIAS.filter(function (r) {
      if (r.tipo !== tipo) return false;
      return tipo === "interface" || !nicho || r.nicho === nicho;
    });
  }

  function preencherNichos() {
    var sel = $("refsNicho");
    if (sel.options.length) return;
    window.NICHOS.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      sel.appendChild(o);
    });
    var todos = document.createElement("option");
    todos.value = "";
    todos.textContent = "Todos os nichos";
    sel.insertBefore(todos, sel.firstChild);
    sel.value = "";
  }

  function renderRefs() {
    var grid = $("refsGrid");
    if (!grid) return;
    preencherNichos();
    $("refsNichoWrap").hidden = $("refsTipo").value !== "site";
    var lista = filtrar();
    grid.textContent = "";
    if (!lista.length) {
      var vazio = document.createElement("p");
      vazio.className = "refs-empty";
      vazio.textContent = "Ainda não há referências para este filtro.";
      grid.appendChild(vazio);
      return;
    }
    lista.forEach(function (r) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ref-card";
      btn.dataset.id = r.id;
      var fig = document.createElement("div");
      fig.className = "ref-img";
      if (r.img) {
        var im = document.createElement("img");
        im.loading = "lazy";
        im.alt = "Captura de tela de " + r.nome;
        im.src = r.img;
        fig.appendChild(im);
      } else {
        var s = document.createElement("span");
        s.textContent = "Sem captura";
        fig.appendChild(s);
      }
      var nome = document.createElement("b");
      nome.textContent = r.nome;
      var meta = document.createElement("small");
      meta.textContent = r.nicho || "Interface";
      btn.append(fig, nome, meta);
      grid.appendChild(btn);
    });
  }

  function abrirDetalhe(r, origem) {
    var dlg = $("refDialog");
    var corpo = $("refDialogBody");
    corpo.textContent = "";
    var h = document.createElement("h3");
    h.textContent = r.nome;
    var meta = document.createElement("p");
    meta.className = "ref-meta";
    meta.textContent = r.nicho || "Interface";
    corpo.append(h, meta);
    if (r.img) {
      var im = document.createElement("img");
      im.className = "ref-dialog-img";
      im.alt = "Captura de tela de " + r.nome;
      im.src = r.img;
      corpo.appendChild(im);
    }
    if (r.descricao) {
      var d = document.createElement("p");
      d.textContent = r.descricao;
      corpo.appendChild(d);
    }
    if (r.observar && r.observar.length) {
      var t = document.createElement("h4");
      t.textContent = "O que observar";
      var ul = document.createElement("ul");
      r.observar.forEach(function (x) {
        var li = document.createElement("li");
        li.textContent = x;
        ul.appendChild(li);
      });
      corpo.append(t, ul);
    }
    if (r.url) {
      var a = document.createElement("a");
      a.href = r.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Abrir site de referência";
      a.className = "ref-link";
      corpo.appendChild(a);
    }
    gatilho = origem;
    dlg.showModal();
  }

  function ligar() {
    if (ligado) return;
    ligado = true;
    $("refsTipo").addEventListener("change", renderRefs);
    $("refsNicho").addEventListener("change", renderRefs);
    $("refsGrid").addEventListener("click", function (e) {
      var card = e.target.closest && e.target.closest(".ref-card");
      if (!card) return;
      var r = window.REFERENCIAS.find(function (x) { return String(x.id) === card.dataset.id; });
      if (r) abrirDetalhe(r, card);
    });
    var dlg = $("refDialog");
    dlg.querySelector(".ref-close").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () { if (gatilho) gatilho.focus(); gatilho = null; });
  }

  window.renderRefs = function () {
    if (!$("refsGrid")) return;
    ligar();
    renderRefs();
  };
})();
