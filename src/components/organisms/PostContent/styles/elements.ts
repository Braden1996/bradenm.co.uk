import { lighten, darken, setSaturation, math } from 'polished';

import { css, media } from '@styled';

const elements = css`
  position: relative;
  margin: 0 auto;
  padding: ${p => p.theme.dimensions.use.screen};
  min-height: 230px;
  background: ${p => p.theme.colors.use.background.primary};
  border-radius: ${p => p.theme.dimensions.use.borderRadius.large};
  overflow: hidden;

  ${media.lessThan('mobile')`
    padding: ${p => math(`${p.theme.dimensions.use.screen} / 2`)};
  `}

  > div > *:last-child {
    margin-bottom: 0;
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
    max-width: ${p => p.theme.dimensions.use.breakpoints.default};
    height: auto;

    ${media.lessThan('default')`
      width: 100%;
    `}
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

  h1, h2, h3, h4, h6 {
    margin: 0.5em 0 0.2em 0;
  }

  h5 {
    display: block;
    margin: 0.5em 0;
    padding: 1em 0 1.5em;
    border: 0;
    text-align: center;

    ${media.greaterThan('mobile')`
      padding: 0 0 0.5em;
    `}

    ${p => media.lessThan('large')`
      max-width: ${p.theme.dimensions.use.breakpoints.default};
    `}
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
  }
  table th {
    letter-spacing: 0.2px;
    text-align: left;
    text-transform: uppercase;
    background-color: ${p => lighten('0.04', p.theme.colors.use.background.secondary)};
  }
  table th,
  table td {
    padding: ${p => p.theme.dimensions.base.small} ${p => p.theme.dimensions.base.normal};
    border: ${p => setSaturation('0.05', darken('0.01', p.theme.colors.use.background.secondary))} 1px solid;
  }
`;

export default elements;
