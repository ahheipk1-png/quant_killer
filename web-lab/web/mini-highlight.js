// Small regex-based syntax highlighter for the Source code page.
// Deliberately hand-written rather than vendoring a library: this is a
// read-only viewer for already-clean, formatted source files, not a general
// editor, so a tokenizer covering comments/strings/numbers/keywords is
// plenty -- consistent with the rest of web-lab, which hand-writes its own
// engines rather than reaching for dependencies where one isn't load-bearing.

(function () {
  "use strict";

  const KEYWORDS = {
    python: [
      "def", "class", "return", "if", "elif", "else", "for", "while", "import", "from",
      "as", "in", "is", "not", "and", "or", "raise", "try", "except", "finally", "with",
      "lambda", "None", "True", "False", "self", "pass", "break", "continue", "yield",
      "global", "nonlocal", "assert", "del", "async", "await",
    ],
    cpp: [
      "namespace", "using", "class", "struct", "template", "typename", "public", "private",
      "protected", "return", "if", "else", "for", "while", "do", "switch", "case", "default",
      "break", "continue", "const", "constexpr", "static", "inline", "void", "int", "double",
      "float", "bool", "char", "auto", "true", "false", "nullptr", "throw", "try", "catch",
      "new", "delete", "sizeof", "explicit", "virtual", "override", "friend", "operator",
      "std", "uint32_t", "uint64_t", "int32_t", "int64_t", "size_t",
    ],
    rust: [
      "fn", "let", "mut", "pub", "struct", "enum", "impl", "trait", "match", "if", "else",
      "for", "while", "loop", "return", "use", "mod", "crate", "self", "Self", "as", "const",
      "static", "unsafe", "where", "dyn", "move", "ref", "in", "true", "false", "break",
      "continue", "type", "async", "await", "extern",
    ],
    csharp: [
      "namespace", "using", "class", "struct", "public", "private", "protected", "internal",
      "static", "readonly", "const", "return", "if", "else", "for", "foreach", "while", "do",
      "switch", "case", "default", "break", "continue", "void", "int", "double", "float",
      "bool", "string", "var", "true", "false", "null", "new", "throw", "try", "catch",
      "finally", "sealed", "override", "virtual", "abstract", "in", "out", "this", "base",
      "double[]", "async", "await",
    ],
  };

  const STRING_RULES = {
    python: /("""[\s\S]*?"""|'''[\s\S]*?'''|f?"(?:[^"\\]|\\.)*"|f?'(?:[^'\\]|\\.)*')/,
    cpp: /(R"\([\s\S]*?\)"|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/,
    rust: /(r#*"[\s\S]*?"#*|"(?:[^"\\]|\\.)*")/,
    csharp: /(\$@"(?:[^"]|"")*"|@"(?:[^"]|"")*"|\$"(?:[^"\\]|\\.)*"|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/,
  };

  const COMMENT_RULES = {
    python: /(#[^\n]*)/,
    cpp: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/,
    rust: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/,
    csharp: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/,
  };

  const PREPROC_RULES = {
    python: /(^\s*@\w[\w.]*)/m,
    cpp: /(^\s*#\s*\w+.*$)/m,
    rust: /(#!?\[[\s\S]*?\])/,
    csharp: /(^\s*#\s*\w+.*$)/m,
  };

  const NUMBER_RULE = /\b(0x[0-9a-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?[uUlLfF]*)\b/;
  const RUST_MACRO_RULE = /\b([a-zA-Z_]\w*!)/;

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Tokenizes by repeatedly finding the earliest match among all rule
  // classes (comment > string > preprocessor > number > keyword > macro),
  // consistent with how most hand-rolled highlighters resolve overlaps.
  function highlight(code, lang) {
    const rules = [
      { cls: "tok-com", re: COMMENT_RULES[lang] },
      { cls: "tok-str", re: STRING_RULES[lang] },
      { cls: "tok-pre", re: PREPROC_RULES[lang] },
    ].filter((r) => r.re);

    let out = "";
    let rest = code;
    let guard = 0;
    while (rest.length > 0 && guard++ < 100000) {
      let earliest = null;
      for (const rule of rules) {
        const m = rule.re.exec(rest);
        if (m && (earliest === null || m.index < earliest.index)) {
          earliest = { index: m.index, text: m[0], cls: rule.cls };
        }
      }
      if (earliest === null) {
        out += highlightPlain(rest, lang);
        break;
      }
      out += highlightPlain(rest.slice(0, earliest.index), lang);
      out += `<span class="${earliest.cls}">${escapeHtml(earliest.text)}</span>`;
      rest = rest.slice(earliest.index + earliest.text.length);
    }
    return out;
  }

  // Applies keyword/number/macro highlighting to a plain (non-string,
  // non-comment) segment, word by word.
  function highlightPlain(segment, lang) {
    const kws = new Set(KEYWORDS[lang] || []);
    let out = "";
    let rest = segment;
    let guard = 0;
    while (rest.length > 0 && guard++ < 200000) {
      const numberMatch = NUMBER_RULE.exec(rest);
      const macroMatch = lang === "rust" ? RUST_MACRO_RULE.exec(rest) : null;
      const wordMatch = /\b[a-zA-Z_]\w*\b/.exec(rest);

      const candidates = [
        numberMatch && { index: numberMatch.index, text: numberMatch[0], cls: "tok-num" },
        macroMatch && { index: macroMatch.index, text: macroMatch[0], cls: "tok-macro" },
        wordMatch && {
          index: wordMatch.index,
          text: wordMatch[0],
          cls: kws.has(wordMatch[0]) ? "tok-kw" : null,
        },
      ].filter(Boolean);

      if (candidates.length === 0) {
        out += escapeHtml(rest);
        break;
      }
      candidates.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
      const first = candidates[0];
      out += escapeHtml(rest.slice(0, first.index));
      out += first.cls ? `<span class="${first.cls}">${escapeHtml(first.text)}</span>` : escapeHtml(first.text);
      rest = rest.slice(first.index + first.text.length);
    }
    return out;
  }

  window.QkHighlight = { highlight };
})();
