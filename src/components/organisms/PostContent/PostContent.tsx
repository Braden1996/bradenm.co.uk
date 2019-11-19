import { lighten, darken, setSaturation } from 'polished';
import * as React from 'react';
import RehypeReact from 'rehype-react';

import styled from '@styled';

export const PostFullContent = styled.section`
  color: ${p => p.theme.colors.use.text.primary};
  position: relative;
  margin: 0 auto;
  padding: ${p => p.theme.dimensions.use.screen};
  min-height: 230px;
  font-family: Georgia, serif;
  font-size: 1.2rem;
  line-height: 1.5em;
  background: ${p => p.theme.colors.use.background.primary};
  border-radius: ${p => p.theme.dimensions.use.borderRadius.large};

  @media (max-width: 1170px) {
    padding: 5vw 7vw 0;
  }

  @media (max-width: 800px) {
    font-size: 1.9rem;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  p,
  ul,
  ol,
  dl,
  pre,
  blockquote,
  .post-full-comments,
  .footnotes {
    min-width: 100%;
  }

  li {
    word-break: break-word;
  }

  li p {
    margin: 0;
  }

  a {
    color: ${p => p.theme.colors.use.text.primary};
    word-break: break-word;
    box-shadow: ${p => p.theme.colors.use.accent.primary} 0 -1px 0 inset;
  }

  a:hover {
    color: ${p => p.theme.colors.use.accent.primary};
    text-decoration: none;
  }

  strong,
  em {
    color: ${p => darken('0.05', p.theme.colors.use.text.primary)};
  }

  small {
    display: inline-block;
    line-height: 1.6em;
  }

  li:first-child {
    margin-top: 0;
  }

  .gatsby-resp-image-link {
    box-shadow: none;
  }

  img,
  video {
    display: block;
    margin: 1.5em auto;
    max-width: 1040px;
    height: auto;
  }

  @media (max-width: 1040px) {
    img,
    video {
      width: 100%;
    }
  }

  img[src$='#full'] {
    max-width: none;
    width: 100vw;
  }

  img + br + small {
    display: block;
    margin-top: -3em;
    margin-bottom: 1.5em;
    text-align: center;
  }

  /* Override third party iframe styles */
  iframe {
    margin: 0 auto !important;
  }

  blockquote {
    margin: 0 0 1.5em;
    padding: 0 1.5em;
    border-left: ${p => p.theme.colors.use.accent.primary} 3px solid;
  }

  blockquote p {
    margin: 0 0 1em 0;
    color: inherit;
    font-size: inherit;
    line-height: inherit;
    font-style: italic;
  }

  blockquote p:last-child {
    margin-bottom: 0;
  }

  code {
    padding: 0 5px 2px;
    font-size: 0.8em;
    line-height: 1em;
    font-weight: 400 !important;
    background: ${p => p.theme.colors.use.background.secondary};
    border-radius: 3px;
  }

  p code {
    word-break: break-all;
  }

  pre {
    overflow-x: auto;
    padding: 20px;
    max-width: 100%;
    border: ${p => darken('0.01', p.theme.colors.use.text.primary)} 1px solid;
    color: ${p => p.theme.colors.use.background.secondary};
    font-size: 1.4rem;
    line-height: 1.5em;
    background: ${p => darken('0.03', p.theme.colors.use.text.primary)};
    border-radius: 5px;
  }

  pre code {
    padding: 0;
    font-size: inherit;
    line-height: inherit;
    background: transparent;
  }

  pre code :not(span) {
    color: inherit;
  }

  /* .fluid-width-video-wrapper { */
  .gatsby-resp-iframe-wrapper {
    margin: 1.5em 0 3em;
  }

  hr {
    margin: 4vw 0;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    color: ${p => p.theme.colors.use.text.primary};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
      'Open Sans', 'Helvetica Neue', sans-serif;
  }

  h1 {
    margin: 0.5em 0 0.2em 0;
    font-size: 4.6rem;
    font-weight: 700;
  }

  @media (max-width: 500px) {
    h1 {
      font-size: 2.8rem;
    }
  }

  h2 {
    margin: 0.5em 0 0.2em 0;
    font-size: 3.6rem;
    font-weight: 700;
  }

  @media (max-width: 500px) {
    h2 {
      font-size: 2.6rem;
    }
  }

  h3 {
    margin: 0.5em 0 0.2em 0;
    font-size: 2.8rem;
    font-weight: 700;
  }

  @media (max-width: 500px) {
    h3 {
      font-size: 2.2rem;
    }
  }

  h4 {
    margin: 0.5em 0 0.2em 0;
    font-size: 2.8rem;
    font-weight: 700;
  }

  @media (max-width: 500px) {
    h4 {
      font-size: 2.2rem;
    }
  }

  h5 {
    display: block;
    margin: 0.5em 0;
    padding: 1em 0 1.5em;
    border: 0;
    color: ${p => p.theme.colors.use.text.secondary};
    font-family: Georgia, serif;
    font-size: 3.2rem;
    line-height: 1.35em;
    text-align: center;
  }

  @media (min-width: 1180px) {
    h5 {
      max-width: 1060px;
    }
  }

  @media (max-width: 500px) {
    h5 {
      padding: 0 0 0.5em;
      font-size: 2.2rem;
    }
  }

  h6 {
    margin: 0.5em 0 0.2em 0;
    font-size: 2.3rem;
    font-weight: 700;
  }

  @media (max-width: 500px) {
    h6 {
      font-size: 2rem;
    }
  }

  table {
    display: inline-block;
    overflow-x: auto;
    margin: 0.5em 0 2.5em;
    max-width: 100%;
    width: auto;
    border-spacing: 0;
    border-collapse: collapse;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
      'Open Sans', 'Helvetica Neue', sans-serif;
    font-size: 1.6rem;
    white-space: nowrap;
    vertical-align: top;
    -webkit-overflow-scrolling: touch;
    background-attachment: scroll, scroll;
    background-size: 10px 100%, 10px 100%;
    background-repeat: no-repeat;
  }
  table th {
    font-size: 1.2rem;
    font-weight: 700;
    letter-spacing: 0.2px;
    text-align: left;
    text-transform: uppercase;
    background-color: ${p => lighten('0.04', p.theme.colors.use.background.secondary)};
  }
  table th,
  table td {
    padding: 6px 12px;
    border: ${p => setSaturation('0.05', darken('0.01', p.theme.colors.use.background.secondary))} 1px solid;
  }

  /* Start Syntax Highlighting */
  /* Taken from overreacted https://github.com/gaearon/overreacted.io/blob/942b41555f5e5ccbb5f93f6c26142cd90b314236/src/utils/global.css#L68 */
  code[class*='language-'],
  pre[class*='language-'] {
    background: none;
    font-family: Consolas, Menlo, Monaco, source-code-pro, Courier New, monospace;
    font-feature-settings: normal;
    text-align: left;
    white-space: pre;
    word-spacing: normal;
    word-break: normal;
    word-wrap: normal;
    line-height: 1.5;
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
  pre[class*='language-']::-moz-selection {
    /* Firefox */
    background: hsl(207, 4%, 16%);
  }
  pre[class*='language-']::selection {
    /* Safari */
    background: hsl(207, 4%, 16%);
  }
  /* Text Selection colour */
  pre[class*='language-']::-moz-selection,
  pre[class*='language-'] ::-moz-selection {
    text-shadow: none;
    background: hsla(0, 0%, 100%, 0.15);
  }
  pre[class*='language-']::selection,
  pre[class*='language-'] ::selection {
    text-shadow: none;
    background: hsla(0, 0%, 100%, 0.15);
  }
  /* Inline code */
  :not(pre) > code[class*='language-'] {
    border-radius: 0.3em;
    background: var(--inlineCode-bg);
    color: var(--inlineCode-text);
    padding: 0.15em 0.2em 0.05em;
    white-space: normal;
  }
  .token.attr-name {
    color: rgb(173, 219, 103);
    font-style: italic;
  }
  .token.comment {
    color: rgb(128, 147, 147);
  }
  .token.string,
  .token.url {
    color: rgb(173, 219, 103);
  }
  .token.variable {
    color: rgb(214, 222, 235);
  }
  .token.number {
    color: rgb(247, 140, 108);
  }
  .token.builtin,
  .token.char,
  .token.constant,
  .token.function {
    color: rgb(130, 170, 255);
  }
  .token.punctuation {
    color: rgb(199, 146, 234);
  }
  .token.selector,
  .token.doctype {
    color: rgb(199, 146, 234);
    font-style: 'italic';
  }
  .token.class-name {
    color: rgb(255, 203, 139);
  }
  .token.tag,
  .token.operator,
  .token.keyword {
    color: #ffa7c4;
  }
  .token.boolean {
    color: rgb(255, 88, 116);
  }
  .token.property {
    color: rgb(128, 203, 196);
  }
  .token.namespace {
    color: rgb(178, 204, 214);
  }
  pre[data-line] {
    padding: 1em 0 1em 3em;
    position: relative;
  }
  .gatsby-highlight-code-line {
    background-color: hsla(207, 95%, 15%, 1);
    display: block;
    margin-right: -1.3125rem;
    margin-left: -1.3125rem;
    padding-right: 1em;
    padding-left: 1.25em;
    border-left: 0.25em solid #ffa7c4;
  }
  .gatsby-highlight {
    margin-bottom: 1.75rem;
    margin-left: -1.3125rem;
    margin-right: -1.3125rem;
    border-radius: 10px;
    background: #011627;
    -webkit-overflow-scrolling: touch;
    overflow: auto;
  }
  @media (max-width: 672px) {
    .gatsby-highlight {
      border-radius: 0;
    }
  }
  .gatsby-highlight pre[class*='language-'] {
    float: left;
    min-width: 100%;
  }
  /* End Syntax Highlighting */
`;

const renderAst = new RehypeReact({
  createElement: React.createElement,
  // components: { 'interactive-counter': Counter },
  components: {},
}).Compiler;

const Ast = ({ ast, ...props }: any) => {
  ast.properties = props;
  return renderAst(ast);
};

export interface PostContentProps {
  htmlAst: any;
}

const PostContent: React.FC<PostContentProps> = ({ htmlAst }) => {
  return (
    <PostFullContent className="post-full-content">
      {/* TODO: this will apply the class when rehype-react is published https://github.com/rhysd/rehype-react/pull/11 */}
      <Ast className="post-content" ast={htmlAst} />
    </PostFullContent>
  );
};

export default PostContent;
