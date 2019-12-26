import GithubCorner from 'react-github-corner';

import styled from '@styled';
import config from '@config';

const StyledGithubCorner = styled(GithubCorner).attrs(p => ({
  href: config.site.publicGithubRepo,
  bannerColor: p.theme.colors.use.background.secondary,
  octoColor: p.theme.colors.use.background.tertiary,
}))`
  opacity: 0.6;
  transition: opacity 200ms linear;

  /* Revert link style */
  border-bottom: initial;

  &:hover {
    opacity: 1;
  }
`;

export default StyledGithubCorner;
