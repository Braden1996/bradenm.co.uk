import * as React from 'react';
import { FaGithub, FaLinkedin, FaTwitter } from 'react-icons/fa';

import styled, { css, theme } from '@styled';

const styledIconFactory = (
  icon: React.FC,
  color: keyof typeof theme.colors.use.social,
) => styled(icon)`
  &:hover {
    color: ${p => p.theme.colors.base[color]};
  }
`;

const StyledGithub = styledIconFactory(FaGithub, 'github');
const StyledLinkedIn = styledIconFactory(FaLinkedin, 'linkedIn');
const StyledTwitter = styledIconFactory(FaTwitter, 'twitter');

const SocialIcon = styled.li`
  display: flex;
  ${p => css`
    font-size: ${p.theme.typography.scale(0.4).fontSize};
    line-height: ${p.theme.typography.scale(0.4).fontSize};
  `}

  & > a {
    display: flex;

    /* Reset Typography theme */
    color: inherit;
    background-image: none;
  }

  margin-bottom: 0;
`;

const Container = styled.ol`
  display: flex;

  list-style: none;
  margin-bottom: 0;
  margin-left: 0;

  & > ${SocialIcon}:not(:last-child) {
    margin-right: ${p => p.theme.dimensions.use.margin};
  }
`;

interface Props {
  github?: string;
  linkedIn?: string;
  twitter?: string;
  className?: string;
}

const SocialIcons: React.FC<Props> = ({ className, github, linkedIn, twitter }) => (
  <Container className={className}>
    {twitter && <SocialIcon><a href={twitter} title="My Twitter profile"><StyledTwitter /></a></SocialIcon>}
    {github && <SocialIcon><a href={github} title="My Github profile"><StyledGithub /></a></SocialIcon>}
    {linkedIn && <SocialIcon><a href={linkedIn} title="My LinkedIn profile"><StyledLinkedIn /></a></SocialIcon>}
  </Container>
);

export default SocialIcons;
