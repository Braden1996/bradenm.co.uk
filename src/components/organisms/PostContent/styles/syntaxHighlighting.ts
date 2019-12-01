import { css, media } from '@styled';

const syntaxHighlighting = css`
  code[class*='language-'],
  pre[class*='language-'] {
    background: none;
    font-feature-settings: normal;
    text-align: left;
    white-space: pre;
    word-spacing: normal;
    word-break: normal;
    word-wrap: normal;
    margin-bottom: 0;
    -moz-tab-size: 4;
    -o-tab-size: 4;
    tab-size: 4;
    -webkit-hyphens: none;
    -moz-hyphens: none;
    -ms-hyphens: none;
    hyphens: none;
  }
  /* Code blocks */
  pre[class*='language-'] {
    overflow: auto;
    padding: 1.3125rem;
  }
  /* Text Selection colour */
  pre[class*='language-']::-moz-selection,
  pre[class*='language-'] ::-moz-selection {
    text-shadow: none;
    background: ${p => p.theme.colors.base.nord3};
  }
  pre[class*='language-']::selection,
  pre[class*='language-'] ::selection {
    text-shadow: none;
    background: ${p => p.theme.colors.base.nord3};
  }
  /* Inline code */
  :not(pre) > code[class*='language-'] {
    border-radius: ${p => p.theme.dimensions.use.borderRadius.normal};
    padding: 0.15em 0.2em 0.05em;
    white-space: normal;
  }
  .token.attr-name {
    color: ${p => p.theme.colors.base.nord14};
    font-style: italic;
  }
  .token.comment {
    color: rgb(128, 147, 147);
  }
  .token.string,
  .token.url {
    color: ${p => p.theme.colors.base.nord14};
  }
  .token.variable {
    color: ${p => p.theme.colors.base.nord6};
  }
  .token.number {
    color: ${p => p.theme.colors.base.nord15};
  }
  .token.builtin,
  .token.char,
  .token.constant,
  .token.function {
    color: ${p => p.theme.colors.base.nord13};
  }
  .token.punctuation {
    color: ${p => p.theme.colors.base.nord9};
  }
  .token.selector,
  .token.doctype {
    color: ${p => p.theme.colors.base.nord9};
    font-style: 'italic';
  }
  .token.class-name {
    color: ${p => p.theme.colors.base.nord12};
  }
  .token.tag,
  .token.operator,
  .token.keyword {
    color: ${p => p.theme.colors.base.nord7};
  }
  .token.boolean {
    color: ${p => p.theme.colors.base.nord11};
  }
  .token.property {
    color: ${p => p.theme.colors.base.nord8};
  }
  .token.namespace {
    color: ${p => p.theme.colors.base.nord9};
  }
  pre[data-line] {
    padding: 1em 0 1em 3em;
    position: relative;
  }
  .gatsby-highlight-code-line, .gatsby-highlight {
    margin-right: -1.3125rem;
    margin-left: -1.3125rem;
  }
  .gatsby-highlight-code-line {
    background-color: ${p => p.theme.colors.base.nord3};
    display: block;
    padding-right: 1em;
    padding-left: 1.25em;
    border-left: 0.25em solid ${p => p.theme.colors.use.accent.primary};
  }
  .gatsby-highlight {
    margin-bottom: 1.75rem;
    background-color: ${p => p.theme.colors.base.nord0};
    -webkit-overflow-scrolling: touch;
    overflow: auto;
  }
  .gatsby-highlight, .gatsby-highlight pre {
    border-radius: ${p => p.theme.dimensions.use.borderRadius.large};
  }

  .gatsby-highlight pre[class*='language-'] {
    float: left;
    min-width: 100%;
  }

  ${media.lessThan('tablet')`
    .gatsby-highlight, .gatsby-highlight pre {
      border-radius: 0;
    }
  `}
`;

export default syntaxHighlighting;
