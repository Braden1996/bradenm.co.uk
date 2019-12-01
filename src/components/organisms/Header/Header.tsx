import * as React from 'react';
import { Link } from 'gatsby';

import styled, { css, media } from '@styled';
import { SocialIcons } from '@molecules';
import config from '@config';

const StyledSocialIcons = styled(SocialIcons)``;

const Container = styled.header`
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  margin-top: ${p => p.theme.dimensions.use.screen};
  margin-bottom: ${p => p.theme.dimensions.base.small};

  & > ${StyledSocialIcons} {
    align-self: flex-end;
  }

  ${media.lessThan('default')`
    & > ${StyledSocialIcons} {
      align-self: center;
    }

    margin-top: ${p => p.theme.dimensions.base.small};
    margin-bottom: ${p => p.theme.dimensions.base.small};
  `}
`;

const Title = styled(Link)`
  ${p => css`
    font-size: ${p.theme.typography.scale(1.2).fontSize};
    line-height: ${p.theme.typography.scale(1.2).fontSize};
  `}

  color: ${p => p.theme.colors.use.text.primary};
  text-transform: uppercase;
  text-align: center;

  /* Reset Typography theme */
  border-bottom: none;
`;

interface Props {
  className?: string;
}

const Header: React.FC<Props> = ({ className }) => (
  <Container className={className}>
    <Title to="/">{config.site.name}</Title>
    <StyledSocialIcons {...config.site.social} />
  </Container>
);

export default Header;
