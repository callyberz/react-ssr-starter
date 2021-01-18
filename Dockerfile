FROM node:10-jessie

RUN npm install -g node-gyp

COPY package.json /tmp
RUN cd /tmp && npm install
RUN mkdir -p /opt/app && cp -a /tmp/node_modules /opt/app/

# Copy application files
WORKDIR /opt/app
COPY . /opt/app

ARG MODE
ENV NODE_ENV=${MODE}
