import { lighten, darken, setSaturation } from 'polished';

import { css } from '@styled';

const elements = css`
  position: relative;
  margin: 0 auto;
  padding: ${p => p.theme.dimensions.use.screen};
  min-height: 230px;
  background: ${p => p.theme.colors.use.background.primary};
  border-radius: ${p => p.theme.dimensions.use.borderRadius.large};

  @media (max-width: 1170px) {
    padding: 5vw 7vw 0;
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
    word-break: break-word;
  }

  a:hover {
    text-decoration: none;
  }

  small {
    display: inline-block;
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
    font-style: italic;
  }

  blockquote p:last-child {
    margin-bottom: 0;
  }

  code {
    padding: 0 5px 2px;
    background: ${p => p.theme.colors.use.background.secondary};
  }

  p code {
    word-break: break-all;
  }

  pre {
    overflow-x: auto;
    padding: 20px;
    max-width: 100%;
    border: ${p => darken('0.1', p.theme.colors.use.background.primary)} 1px solid;
    background: ${p => darken('0.03', p.theme.colors.use.text.primary)};
    border-radius: ${p => p.theme.dimensions.use.borderRadius.normal};
  }

  pre code {
    padding: 0;
    background: transparent;
  }

  /* .fluid-width-video-wrapper { */
  .gatsby-resp-iframe-wrapper {
    margin: 1.5em 0 3em;
  }

  hr {
    margin: 4vw 0;
  }

  h1 {
    margin: 0.5em 0 0.2em 0;
  }

  h2 {
    margin: 0.5em 0 0.2em 0;
  }

  h3 {
    margin: 0.5em 0 0.2em 0;
  }

  h4 {
    margin: 0.5em 0 0.2em 0;
  }

  h5 {
    display: block;
    margin: 0.5em 0;
    padding: 1em 0 1.5em;
    border: 0;
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
    }
  }

  h6 {
    margin: 0.5em 0 0.2em 0;
  }

  table {
    display: inline-block;
    overflow-x: auto;
    margin: 0.5em 0 2.5em;
    max-width: 100%;
    width: auto;
    border-spacing: 0;
    border-collapse: collapse;
    white-space: nowrap;
    vertical-align: top;
    -webkit-overflow-scrolling: touch;
    background-attachment: scroll, scroll;
    background-size: 10px 100%, 10px 100%;
    background-repeat: no-repeat;
  }
  table th {
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
`;

export default elements;
