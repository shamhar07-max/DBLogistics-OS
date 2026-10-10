ARG KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.0
FROM ${KEYCLOAK_IMAGE} AS builder
ENV KC_DB=postgres KC_CACHE=local
RUN /opt/keycloak/bin/kc.sh build
FROM ${KEYCLOAK_IMAGE}
COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY infrastructure/free-cloud/keycloak-realm.json /opt/keycloak/data/import/realm.json
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
