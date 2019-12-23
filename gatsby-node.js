const path = require('path');
const _ = require('lodash');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

exports.onCreateNode = ({ node, actions, getNode }) => {
  const { createNodeField } = actions;

  switch (node.internal.type) {
    case 'Mdx': {
      const { relativePath } = getNode(node.parent);
      const slug = path.basename(relativePath, path.extname(relativePath));
      createNodeField({ node, name: 'slug', value: slug });
    }
  }
};

exports.createPages = async ({ graphql, actions }) => {
  const { createPage } = actions;

  const result = await graphql(`
    {
      allMdx (
        sort: { fields: [frontmatter___date], order: ASC }
        filter: { frontmatter: { draft: { ne: true } } }
      ) {
        nodes {
          fields {
            slug
          }
        }
      }
    }
  `);

  if (result.errors) {
    console.error(result.errors);
    throw new Error(result.errors);
  }

  // Create post pages
  const posts = result.data.allMdx.nodes;

  // Create paginated index
  const postsPerPage = 6;
  const numPages = Math.ceil(posts.length / postsPerPage);

  for (let i = 0; i < numPages; i++) {
    createPage({
      path: i === 0 ? '/' : `/${i + 1}`,
      component: path.resolve('src/components/pages/Home/index.ts'),
      context: {
        limit: postsPerPage,
        skip: i * postsPerPage,
        numPages,
        currentPage: i + 1,
      },
    });
  };

  posts.forEach((node, index) => {
    const { slug } = node.fields;

    createPage({
      path: slug,
      component: path.resolve('src/components/pages/Post/index.ts'),
      context: { slug },
    });
  });
};

exports.onCreateWebpackConfig = ({ stage, actions }) => {
  // adds sourcemaps for tsx in dev mode
  if (stage === `develop` || stage === `develop-html`) {
    actions.setWebpackConfig({
      devtool: 'eval-source-map',
    });
  }

  actions.setWebpackConfig({
    resolve: {
      plugins: [new TsconfigPathsPlugin({})],
    },
  });
};
