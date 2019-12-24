import { graphql } from 'gatsby';

import Home from './Home.component';

export default Home;

export const pageQuery = graphql`
  query homePage($skip: Int!, $limit: Int!) {
    allMdx (
      sort: { fields: [frontmatter___date], order: DESC }
      filter: { frontmatter: { draft: { ne: true }, hidden: { ne: true } } }
      limit: $limit
      skip: $skip
    ){
      nodes {
        timeToRead
        frontmatter {
          title
          date
          tags
          image {
            childImageSharp {
              fluid(maxWidth: 3720) {
                ...GatsbyImageSharpFluid
              }
            }
          }
        }
        excerpt
        fields {
          slug
        }
      }
    }
  }
`;
