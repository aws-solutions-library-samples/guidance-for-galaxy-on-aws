# Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import boto3
import logging
import os
import json
import requests
from requests.auth import HTTPBasicAuth


logger = logging.getLogger()
logger.setLevel(logging.INFO)
host = os.environ["HOST"] # "HOST=https://xxxx:443

def handler(event, context):
    """Secrets Manager Rotation Template

    This is a template for creating an AWS Secrets Manager rotation lambda

    Args:
        event (dict): Lambda dictionary of event parameters. These keys must include the following:
            - SecretId: The secret ARN or identifier
            - ClientRequestToken: The ClientRequestToken of the secret version
            - Step: The rotation step (one of createSecret, setSecret, testSecret, or finishSecret)

        context (LambdaContext): The Lambda runtime information

    Raises:
        ResourceNotFoundException: If the secret with the specified arn and stage does not exist

        ValueError: If the secret is not properly configured for rotation

        KeyError: If the event parameters do not contain the expected keys

    """
    arn = event['SecretId']
    token = event['ClientRequestToken']
    step = event['Step']

    # Setup the client
    service_client = boto3.client('secretsmanager')

    # Make sure the version is staged correctly
    metadata = service_client.describe_secret(SecretId=arn)
    if not metadata['RotationEnabled']:
        logger.error("Secret %s is not enabled for rotation" % arn)
        raise ValueError("Secret %s is not enabled for rotation" % arn)
    versions = metadata['VersionIdsToStages']
    if token not in versions:
        logger.error("Secret version %s has no stage for rotation of secret %s." % (token, arn))
        raise ValueError("Secret version %s has no stage for rotation of secret %s." % (token, arn))
    if "AWSCURRENT" in versions[token]:
        logger.info("Secret version %s already set as AWSCURRENT for secret %s." % (token, arn))
        return
    elif "AWSPENDING" not in versions[token]:
        logger.error("Secret version %s not set as AWSPENDING for rotation of secret %s." % (token, arn))
        raise ValueError("Secret version %s not set as AWSPENDING for rotation of secret %s." % (token, arn))

    if step == "createSecret":
        create_secret(service_client, arn, token)

    elif step == "setSecret":
        set_secret(service_client, arn, token)

    elif step == "testSecret":
        test_secret(service_client, arn, token)

    elif step == "finishSecret":
        finish_secret(service_client, arn, token)

    else:
        raise ValueError("Invalid step parameter")


def create_secret(service_client, arn, token):
    """Create the secret

    This method first checks for the existence of a secret for the passed in token. If one does not exist, it will generate a
    new secret and put it with the passed in token.

    Args:
        service_client (client): The secrets manager service client

        arn (string): The secret ARN or other identifier

        token (string): The ClientRequestToken associated with the secret version

    Raises:
        ResourceNotFoundException: If the secret with the specified arn and stage does not exist

    """
    # Make sure the current secret exists
    service_client.get_secret_value(SecretId=arn, VersionStage="AWSCURRENT")

    # Now try to get the secret version, if that fails, put a new secret
    try:
        service_client.get_secret_value(SecretId=arn, VersionId=token, VersionStage="AWSPENDING")
        logger.info("createSecret: Successfully retrieved secret for %s." % arn)
    except service_client.exceptions.ResourceNotFoundException:
        # Get exclude characters from environment variable
        exclude_characters = os.environ['EXCLUDE_CHARACTERS'] if 'EXCLUDE_CHARACTERS' in os.environ else '/@"\'\\'
        # Generate a random password
        username = get_secret_dict(service_client, arn, "AWSCURRENT")['username']
        passwd = service_client.get_random_password(ExcludeCharacters=exclude_characters)
        stringpassword = passwd['RandomPassword']

        # Put the secret
        service_client.put_secret_value(SecretId=arn, ClientRequestToken=token, SecretString=f'{{ "username": "{username}", "password": "{stringpassword}" }}', VersionStages=['AWSPENDING'])
        logger.info("createSecret: Successfully put secret for ARN %s and version %s." % (arn, token))

def does_password_authenticate_with_mq(dict):
    username = dict["username"]
    password = dict["password"]

    auth = HTTPBasicAuth(username, password)
    apiAddress = f"{host}/api/users/{username}"
    response = requests.get(
        url=apiAddress, 
        auth=auth,
    )
    print(f"Test yields {response.status_code}")
    if response.status_code == 200:
        return True
    else:
        return False

def send_password_to_mq(auth_dict, update_dict):
    auth_username = auth_dict["username"]
    auth_password = auth_dict["password"]

    username = update_dict["username"]
    password = update_dict["password"]

    auth = HTTPBasicAuth(auth_username, auth_password)
    data =  {
        "username": username,
        "password": password,
        "tags": username
    }

    apiAddress = f"{host}/api/users/{username}"
    response = requests.put(
        url=apiAddress, 
        auth=auth,
        json=data
    )

    return response

def set_secret(service_client, arn, token):
    """Set the secret

    This method should set the AWSPENDING secret in the service that the secret belongs to. For example, if the secret is a database
    credential, this method should take the value of the AWSPENDING secret and set the user's password to this value in the database.

    Args:
        service_client (client): The secrets manager service client

        arn (string): The secret ARN or other identifier

        token (string): The ClientRequestToken associated with the secret version

    """
    # This is where the secret should be set in the service
    # raise NotImplementedError
    try:
        previous_dict = get_secret_dict(service_client, arn, "AWSPREVIOUS")
    except (service_client.exceptions.ResourceNotFoundException, KeyError):
        previous_dict = None
    current_dict = get_secret_dict(service_client, arn, "AWSCURRENT")
    pending_dict = get_secret_dict(service_client, arn, "AWSPENDING", token)

    # First try to login with the pending secret, if it succeeds, return
    successfully_auth = does_password_authenticate_with_mq(pending_dict)
    if successfully_auth:
        logger.info("setSecret: AWSPENDING secret is already set as password in PostgreSQL DB for secret arn %s." % arn)
        return

    # Make sure the user from current and pending match
    if current_dict['username'] != pending_dict['username']:
        logger.error("setSecret: Attempting to modify user %s other than current user %s" % (pending_dict['username'], current_dict['username']))
        raise ValueError("Attempting to modify user %s other than current user %s" % (pending_dict['username'], current_dict['username']))

    # Now try the current password
    auth_dict = current_dict
    successfully_auth = does_password_authenticate_with_mq(current_dict)
    

    # If both current and pending do not work, try previous
    if not successfully_auth and previous_dict:
        auth_dict = previous_dict
        # Update previous_dict to leverage current SSL settings
        previous_dict.pop('ssl', None)
        if 'ssl' in current_dict:
            previous_dict['ssl'] = current_dict['ssl']

        successfully_auth = does_password_authenticate_with_mq(previous_dict)

        # Make sure the user/host from previous and pending match
        if previous_dict['username'] != pending_dict['username']:
            logger.error("setSecret: Attempting to modify user %s other than previous valid user %s" % (pending_dict['username'], previous_dict['username']))
            raise ValueError("Attempting to modify user %s other than previous valid user %s" % (pending_dict['username'], previous_dict['username']))

    # If we still don't have a connection, raise a ValueError
    if not successfully_auth:
        logger.error("setSecret: Unable to authenticate with MQ with previous, current, or pending secret of secret arn %s" % arn)
        raise ValueError("Unable to authenticate with MQ with previous, current, or pending secret of secret arn %s" % arn)

    # Now set the password to the pending password
    send_password_to_mq(auth_dict, pending_dict)
    logger.info("setSecret: Successfully set password for user %s in RabbitMQ for secret arn %s." % (pending_dict['username'], arn))




def test_secret(service_client, arn, token):
    """Test the secret

    Calls the API of RabbitMQ to check authorization

    Raises:
        ResourceNotFoundException: If the secret with the specified arn and stage does not exist

        ValueError: If the secret is not valid JSON or valid credentials are found to login to the database

        KeyError: If the secret json does not contain the expected keys

    """
    # Try to login with the pending secret, if it succeeds, return
    conn = does_password_authenticate_with_mq(get_secret_dict(service_client, arn, "AWSPENDING", token))
    if conn:
        logger.info("testSecret: Successfully authenticated with RabbitMQ AWSPENDING secret in %s." % arn)
        return
    else:
        logger.error("testSecret: Unable to authenticate with RabbitMQ with pending secret of secret ARN %s" % arn)
        raise ValueError("Unable to authenticate with RabbitMQ with pending secret of secret ARN %s" % arn)
    


def finish_secret(service_client, arn, token):
    """Finish the secret

    This method finalizes the rotation process by marking the secret version passed in as the AWSCURRENT secret.

    Args:
        service_client (client): The secrets manager service client

        arn (string): The secret ARN or other identifier

        token (string): The ClientRequestToken associated with the secret version

    Raises:
        ResourceNotFoundException: If the secret with the specified arn does not exist

    """
    # First describe the secret to get the current version
    metadata = service_client.describe_secret(SecretId=arn)
    current_version = None
    for version in metadata["VersionIdsToStages"]:
        if "AWSCURRENT" in metadata["VersionIdsToStages"][version]:
            if version == token:
                # The correct version is already marked as current, return
                logger.info("finishSecret: Version %s already marked as AWSCURRENT for %s" % (version, arn))
                return
            current_version = version
            break

    # Finalize by staging the secret version current
    service_client.update_secret_version_stage(SecretId=arn, VersionStage="AWSCURRENT", MoveToVersionId=token, RemoveFromVersionId=current_version)
    logger.info("finishSecret: Successfully set AWSCURRENT stage to version %s for secret %s." % (token, arn))


def get_secret_dict(service_client, arn, stage, token=None):
    """Gets the secret dictionary corresponding for the secret arn, stage, and token

    This helper function gets credentials for the arn and stage passed in and returns the dictionary by parsing the JSON string

    Args:
        service_client (client): The secrets manager service client

        arn (string): The secret ARN or other identifier

        token (string): The ClientRequestToken associated with the secret version, or None if no validation is desired

        stage (string): The stage identifying the secret version

    Returns:
        SecretDictionary: Secret dictionary

    Raises:
        ResourceNotFoundException: If the secret with the specified arn and stage does not exist

        ValueError: If the secret is not valid JSON

    """
    required_fields = ['username', 'password']

    # Only do VersionId validation against the stage if a token is passed in
    if token:
        secret = service_client.get_secret_value(SecretId=arn, VersionId=token, VersionStage=stage)
    else:
        secret = service_client.get_secret_value(SecretId=arn, VersionStage=stage)
    plaintext = secret['SecretString']
    secret_dict = json.loads(plaintext)

    # Run validations against the secret
    for field in required_fields:
        if field not in secret_dict:
            raise KeyError("%s key is missing from secret JSON" % field)

    # Parse and return the secret JSON string
    return secret_dict
