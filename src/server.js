/**
 * React Starter Kit (https://www.reactstarterkit.com/)
 *
 * Copyright © 2014-present Kriasoft, LLC. All rights reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE.txt file in the root directory of this source tree.
 */
import path from 'path';
import express from 'express';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import http from 'http';
import expressJwt, { UnauthorizedError as Jwt401Error } from 'express-jwt';
import { graphql } from 'graphql';
import expressGraphQL from 'express-graphql';
import DataLoader from 'dataloader';
import { ServerStyleSheets, ThemeProvider } from '@material-ui/styles';
// import jwt from 'jsonwebtoken';
import nodeFetch from 'node-fetch';
import React from 'react';
import ReactDOM from 'react-dom/server';
import PrettyError from 'pretty-error';
import { Provider } from 'react-redux';
import { applyMiddleware } from 'graphql-middleware';
import { ApolloServer, AuthenticationError } from 'apollo-server-express';
import { makeExecutableSchema } from 'apollo-server';
import { allow, deny, shield } from 'graphql-shield';
import { GraphQLLocalStrategy, buildContext } from 'graphql-passport';

import App from './components/App';
import Html from './components/Html';
import { ErrorPageWithoutStyle } from './routes/error/ErrorPage';
import errorPageStyle from './routes/error/ErrorPage.css';
import createFetch from './core/createFetch';
// import passport from './core/passport';
import router from './core/router';
import chunks from './chunk-manifest.json'; // eslint-disable-line import/no-unresolved
import configureStore from './store/configureStore';
import { setRuntimeVariable } from './actions/runtime';

import config from './config';
import schema from './data/schema';
import resolvers from './data/resolvers';
import models, { connectDb } from './data/models';
import loaders from './data/loaders';
import theme from "./core/theme";

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
  // send entire app down. Process manager will restart it
  process.exit(1);
});

//
// Tell any CSS tooling (such as Material UI) to use all vendor prefixes if the
// user agent is not known.
// -----------------------------------------------------------------------------
global.navigator = global.navigator || {};
global.navigator.userAgent = global.navigator.userAgent || 'all';

const app = express();

//
// If you are using proxy from external machine, you can set TRUST_PROXY env
// Default is to trust proxy headers only from loopback interface.
// -----------------------------------------------------------------------------
app.set('trust proxy', config.trustProxy);

//
// Register Node.js middleware
// -----------------------------------------------------------------------------
app.use(express.static(path.resolve(__dirname, 'public')));
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

//
// Authentication
// -----------------------------------------------------------------------------
app.use(
  expressJwt({
    secret: config.auth.jwt.secret,
    credentialsRequired: false,
    getToken: req => req.cookies.id_token,
  }),
);
// Error handler for express-jwt
app.use((err, req, res, next) => {
  // eslint-disable-line no-unused-vars
  if (err instanceof Jwt401Error) {
    console.error('[express-jwt-error]', req.cookies.id_token);
    // `clearCookie`, otherwise user can't use web-app until cookie expires
    res.clearCookie('id_token');
  }
  next(err);
});

// app.use(passport.initialize());

// app.get(
//   '/login/facebook',
//   passport.authenticate('facebook', {
//     scope: ['email', 'user_location'],
//     session: false,
//   }),
// );
// app.get(
//   '/login/facebook/return',
//   passport.authenticate('facebook', {
//     failureRedirect: '/login',
//     session: false,
//   }),
//   (req, res) => {
//     const expiresIn = 60 * 60 * 24 * 180; // 180 days
//     const token = jwt.sign(req.user, config.auth.jwt.secret, { expiresIn });
//     res.cookie('id_token', token, { maxAge: 1000 * expiresIn, httpOnly: true });
//     res.redirect('/');
//   },
// );

//
// Register API middleware
// -----------------------------------------------------------------------------
// app.use(
//   '/graphql',
//   expressGraphQL(req => ({
//     schema,
//     graphiql: __DEV__,
//     rootValue: { request: req },
//     pretty: __DEV__,
//   })),
// );

// use apollo server express
const masterschema = makeExecutableSchema({
  typeDefs: schema['typeDefs'],
  resolvers,
});

const permissions = shield({
  Query: {
    '*': allow,
  },
  Mutation: {
    '*': allow,
  },
});

const server = new ApolloServer({
  introspection: true,
  // typeDefs: schema['typeDefs'],
  // resolvers: resolvers,
  schema: applyMiddleware(masterschema, permissions),
  formatError: error => {
    // remove the internal sequelize error message
    // leave only the important validation error
    const message = error.message
      .replace('SequelizeValidationError: ', '')
      .replace('Validation error: ', '');

    return {
      ...error,
      message,
    };
  },
  context: async ({ req, res }) => {
    if (res) {
      return buildContext({
        req,
        res,
        models,
        loaders: {
          user: new DataLoader(keys => loaders.user.batchUsers(keys, models)),
        },
      });
    }

    if (req) {
      return buildContext({
        req,
        res,
        models,
        User,
        secret: config.secret,
        loaders: {
          user: new DataLoader(keys => loaders.user.batchUsers(keys, models)),
        },
      });
    }
  },
});

server.applyMiddleware({ app, path: '/graphql' });

const httpServer = http.createServer(app);
server.installSubscriptionHandlers(httpServer);

//
// Register server-side rendering middleware
// -----------------------------------------------------------------------------
app.get('*', async (req, res, next) => {
  try {
    const css = new Set();

    // Enables critical path CSS rendering
    // https://github.com/kriasoft/isomorphic-style-loader
    const insertCss = (...styles) => {
      // eslint-disable-next-line no-underscore-dangle
      styles.forEach(style => css.add(style._getCss()));
    };

    // Universal HTTP client
    const fetch = createFetch(nodeFetch, {
      baseUrl: config.api.serverUrl,
      cookie: req.headers.cookie,
      schema,
      graphql,
    });

    const initialState = {
      user: req.user || null,
    };

    const store = configureStore(initialState, {
      fetch,
      // I should not use `history` on server.. but how I do redirection? follow universal-router
    });

    // Global (context) variables that can be easily accessed from any React component
    // https://facebook.github.io/react/docs/context.html
    const context = {
      insertCss,
      fetch,
      // The twins below are wild, be careful!
      pathname: req.path,
      query: req.query,
      // You can access redux through react-redux connect
      store,
      storeSubscription: null,
    };

    const route = await router.resolve(context);

    if (route.redirect) {
      res.redirect(route.status || 302, route.redirect);
      return;
    }

    const sheets = new ServerStyleSheets();
    const data = { ...route };
    data.children = ReactDOM.renderToString(
      sheets.collect(
        <Provider store={store}>
          <App context={context}>
            <ThemeProvider theme={theme}>{route.component}</ThemeProvider>
          </App>
        </Provider>,
      ),
      // <Provider store={store}>
      //   <App context={context}>{route.component}</App>
      // </Provider>,
    );
    data.styles = [{ id: 'css', cssText: [...css].join('') }];

    const scripts = new Set();
    const addChunk = chunk => {
      if (chunks[chunk]) {
        chunks[chunk].forEach(asset => scripts.add(asset));
      } else if (__DEV__) {
        throw new Error(`Chunk with name '${chunk}' cannot be found`);
      }
    };
    addChunk('client');
    if (route.chunk) addChunk(route.chunk);
    if (route.chunks) route.chunks.forEach(addChunk);

    data.scripts = Array.from(scripts);
    data.app = {
      apiUrl: config.api.clientUrl,
      state: context.store.getState(),
    };

    const html = ReactDOM.renderToStaticMarkup(<Html {...data} />);
    res.status(route.status || 200);
    res.send(`<!doctype html>${html}`);
  } catch (err) {
    next(err);
  }
});

//
// Error handling
// -----------------------------------------------------------------------------
const pe = new PrettyError();
pe.skipNodeFiles();
pe.skipPackage('express');

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(pe.render(err));
  const html = ReactDOM.renderToStaticMarkup(
    <Html
      title="Internal Server Error"
      description={err.message}
      styles={[{ id: 'css', cssText: errorPageStyle._getCss() }]} // eslint-disable-line no-underscore-dangle
    >
      {ReactDOM.renderToString(<ErrorPageWithoutStyle error={err} />)}
    </Html>,
  );
  res.status(err.status || 500);
  res.send(`<!doctype html>${html}`);
});

//
// Hot Module Replacement
// -----------------------------------------------------------------------------
//
// Launch the server
// -----------------------------------------------------------------------------
const isTest = !!config.testdatabaseUrl;
const isProduction = config.mode === 'production';
const port = config.port;

if (config.mode == 'production') {
} else if (config.mode == 'development') {
  app.hot = module.hot;
  module.hot.accept('./core/router');
}

connectDb()
  .catch(err => console.error(err))
  .then(() => {
    if (config.mode == 'production') {
      httpServer.listen({ port }, () => {
        console.log(`Apollo Server on http://localhost:${port}/graphql`);
      });
    }
  });

const createTempUsers = async () => {
  console.log('createing 1...');
  const user1 = new models.User({
    username: 'testuser1',
    email: 'hello@robin.com',
    password: 'rwieruch',
    role: 'DIRECTOR',
  });

  const user2 = new models.User({
    username: 'testuser2',
    email: 'hello@david.com',
    password: 'ddavids',
    role: 'MANAGER',
  });

  const user3 = new models.User({
    username: 'testuser3',
    email: 'hello@peter.com',
    password: 'peter22',
    role: 'TEACHER',
  });

  const user4 = new models.User({
    username: 'testuser4',
    email: 'hello@amy.com',
    password: 'amy22222',
    role: 'CAMPUS',
  });

  await user1.save();
  await user2.save();
  await user3.save();
  await user4.save();
};

const createTempStudents = async () => {
  console.log('createing 2...');
  let baseStudent = {
    fullName: 'testuser1',
    email: 'hello@robin.com',
    school: 'rwieruch',
    phoneNumber: '8888888',
    parentName: 'PP Lee',
    parentEmail: 'aaa@gmail.com',
    parentPhoneNumber: '99999999',
    parentRelationship: 'FATHER',
    remark: 'Test',
  };

  const student1 = new models.Student(baseStudent);
  baseStudent.fullName = 'testuser2222';
  const student2 = new models.Student(baseStudent);
  baseStudent.fullName = 'testuser333';
  const student3 = new models.Student(baseStudent);
  baseStudent.fullName = 'testuser444';
  const student4 = new models.Student(baseStudent);
  baseStudent.fullName = 'testuser5555';
  const student5 = new models.Student(baseStudent);

  await student1.save();
  await student2.save();
  await student3.save();
  await student4.save();
  await student5.save();
};

export default app;
